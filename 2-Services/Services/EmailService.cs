using _2_Services.Interfaces;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;

namespace _2_Services.Services
{
    public class EmailService : IEmailService
    {
        private readonly SmtpSettings _smtpSettings;
        private readonly ILogger<EmailService> _logger;

        public EmailService(
            IOptions<SmtpSettings> smtpSettings,
            ILogger<EmailService> logger)
        {
            _smtpSettings = smtpSettings.Value;
            _logger = logger;
        }

        public Task SendVerificationCodeAsync(string email, string code)
            => SendEmailAsync(email, $"Verification Code: {code}", $"Your verification code is: {code}");

        public Task SendPlaceOrderMessage(string email, string messageContent)
            => SendEmailAsync(email, "Order Placed Successfully", messageContent);

        private async Task SendEmailAsync(string email, string subject, string body)
        {
            if (string.IsNullOrWhiteSpace(email))
                throw new BadRequestException("Recipient email is empty.");

            if (!MailboxAddress.TryParse(email, out var recipientAddress))
                throw new BadRequestException($"Invalid email address format: {email}");

            if (string.IsNullOrWhiteSpace(_smtpSettings.Host))
            {
                _logger.LogWarning("SMTP Host is not configured. Email will not be sent to {Email}.", email);
                throw new InvalidOperationException("SMTP Host is not configured.");
            }

            var fromAddress = !string.IsNullOrWhiteSpace(_smtpSettings.Username)
                ? _smtpSettings.Username
                : "noreply@shopnest.com";
            var fromDisplayName = !string.IsNullOrWhiteSpace(_smtpSettings.FromName)
                ? _smtpSettings.FromName
                : "ShopNest";

            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(fromDisplayName, fromAddress));
            message.To.Add(recipientAddress);
            message.Subject = subject;
            message.Body = new TextPart("plain") { Text = body };

            using var smtp = new SmtpClient();

            try
            {
                smtp.ServerCertificateValidationCallback = (s, c, h, e) => true;

                var socketOption = _smtpSettings.Port == 465
                    ? SecureSocketOptions.SslOnConnect
                    : (_smtpSettings.Port == 587 ? SecureSocketOptions.StartTls : SecureSocketOptions.Auto);

                _logger.LogInformation("Connecting to SMTP Server {Host}:{Port}...", _smtpSettings.Host, _smtpSettings.Port);

                await smtp.ConnectAsync(_smtpSettings.Host, _smtpSettings.Port, socketOption);

                if (!string.IsNullOrWhiteSpace(_smtpSettings.Username) && !string.IsNullOrWhiteSpace(_smtpSettings.Password))
                {
                    await smtp.AuthenticateAsync(_smtpSettings.Username.Trim(), _smtpSettings.Password.Trim());
                }

                await smtp.SendAsync(message);
                await smtp.DisconnectAsync(true);

                _logger.LogInformation("Email sent successfully to {Email}", email);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SMTP Error when sending email to {Email}: {Message}", email, ex.Message);
                throw;
            }
        }
    }
}
