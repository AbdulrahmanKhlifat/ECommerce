using _1_Repository.Data;
using _1_Repository.Interfaces;
using _2_Services.Interfaces;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace _2_Services.Services
{
    public class OutBoxMessageService : IOutBoxMessageService
    {
        private readonly IOutBoxMessageRepository _outBoxMessageRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<OutBoxMessageService> _logger;

        public OutBoxMessageService(
            IOutBoxMessageRepository outBoxMessageRepository,
            IUnitOfWork unitOfWork,
            ILogger<OutBoxMessageService> logger)
        {
            _outBoxMessageRepository = outBoxMessageRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task<List<OutboxMessage>> GetPendingMessagesAsync()
        {
            return await _outBoxMessageRepository.GetPendingMessagesAsync();
        }

        public async Task AddOutBoxMessageAsync(OutboxMessage message)
        {
            if (message is null)
            {
                throw new ArgumentNullException(nameof(message));
            }

            await _outBoxMessageRepository.AddAsync(message);
            await _unitOfWork.SaveChangesAsync();
            _logger.LogDebug("OutboxMessage added: Id={MessageId}, Type={Type}", message.Id, message.Type);
        }

        public async Task CreateAndAddMessageAsync<T>(string type, T payload)
        {
            var message = new OutboxMessage
            {
                Type = type,
                Payload = System.Text.Json.JsonSerializer.Serialize(payload),
                CreatedAt = DateTime.UtcNow,
                IsProcessed = false
            };

            await _outBoxMessageRepository.AddAsync(message);
            await _unitOfWork.SaveChangesAsync();
            _logger.LogDebug("Created and queued OutboxMessage: Id={MessageId}, Type={Type}", message.Id, type);
        }

        public async Task MarkAsProcessedAsync(int messageId)
        {
            var message = await _outBoxMessageRepository.GetByIdAsync(messageId);
            if (message != null)
            {
                message.IsProcessed = true;
                message.ProcessedAt = DateTime.UtcNow;
                message.Error = null;
                _outBoxMessageRepository.Update(message);
                await _unitOfWork.SaveChangesAsync();
                _logger.LogInformation("OutboxMessage {MessageId} (Type={Type}) marked as processed", messageId, message.Type);
            }
        }

        public async Task MarkAsFailedAsync(int messageId, string errorReason)
        {
            var message = await _outBoxMessageRepository.GetByIdAsync(messageId);
            if (message != null)
            {
                message.Error = errorReason;
                _outBoxMessageRepository.Update(message);
                await _unitOfWork.SaveChangesAsync();
                _logger.LogError("OutboxMessage {MessageId} (Type={Type}) failed: {ErrorReason}", messageId, message.Type, errorReason);
            }
        }
    }
}
