using _1_Repository.Data;
using _1_Repository.Interfaces;
using _2_Services.Interfaces;
using Microsoft.Extensions.Logging;

namespace _2_Services.Services
{
    public class OrderService : IOrderService
    {
        private readonly IOrderRepository _orderRepository;
        private readonly ICartRepository _cartRepository;
        private readonly IProductRepository _productRepository;
        private readonly ICouponService _couponService;
        private readonly ICustomerService _customerService;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IOutBoxMessageService _outBoxMessageService;
        private readonly ICustomerAddressRepository _addressRepository;
        private readonly ILogger<OrderService> _logger;

        public OrderService(
            IOrderRepository orderRepository,
            ICartRepository cartRepository,
            IProductRepository productRepository,
            ICouponService couponService,
            ICustomerService customerService,
            IUnitOfWork unitOfWork,
            IOutBoxMessageService outBoxMessageService,
            ICustomerAddressRepository addressRepository,
            ILogger<OrderService> logger)
        {
            _orderRepository = orderRepository;
            _cartRepository = cartRepository;
            _productRepository = productRepository;
            _couponService = couponService;
            _customerService = customerService;
            _unitOfWork = unitOfWork;
            _outBoxMessageService = outBoxMessageService;
            _addressRepository = addressRepository;
            _logger = logger;
        }

        public async Task<List<OrderDetailDto>> GetOrdersByCustomerAsync(int customerId)
        {
            ValidateId(customerId, "Customer ID");
            var orders = await _orderRepository.GetCustomerOrdersAsync(customerId);

            return orders.Select(OrderMapper.MapToDetailDto).ToList();
        }
        public async Task<List<OrderDetailDto>> GetAllOrdersAsync()
        {
            var orders = await _orderRepository.GetAllAsync();

            return orders.Select(OrderMapper.MapToDetailDto).ToList();
        }

        public async Task<OrderDetailDto?> GetOrderByIdForAdminAsync(int orderId)
        {
            ValidateId(orderId, "Order ID");

            var order = await _orderRepository.GetOrderWithItemsAsync(orderId)
                ?? throw new NotFoundException($"Order {orderId} not found.");

            return OrderMapper.MapToDetailDto(order);
        }

        public async Task<OrderDetailDto?> GetOrderByIdAsync(int orderId, int customerId, bool isAdmin)
        {
            ValidateId(orderId, "Order ID");

            var order = await _orderRepository.GetOrderWithItemsAsync(orderId)
                ?? throw new NotFoundException($"Order {orderId} not found.");

            if (!isAdmin && order.CustomerId != customerId)
            {
                _logger.LogWarning("Forbidden order access attempt: OrderId={OrderId}, CustomerId={CustomerId}", orderId, customerId);
                throw new ForbiddenException("You do not have permission to view this order.");
            }

            return OrderMapper.MapToDetailDto(order);
        }

        public async Task<OrderDetailDto> PlaceOrderAsync(int customerId, PlaceOrderDto dto)
        {
            ValidateId(customerId, "Customer ID");

            if (dto is null)
            {
                throw new BadRequestException("Order placement data is required.");
            }

            _logger.LogInformation("Initiating order placement for CustomerId={CustomerId}, PaymentMethod={PaymentMethod}, CouponCode={CouponCode}",
                customerId, dto.PaymentMethod, dto.CouponCode);

            await _unitOfWork.BeginTransactionAsync();

            try
            {
                var cart = await ValidateCartAsync(customerId);

                var customer = await _customerService.GetCustomerByIdAsync(customerId)
                    ?? throw new NotFoundException($"Customer {customerId} not found.");

                var shippingSnapshot = await BuildShippingSnapshotAsync(customerId, dto.CustomerAddressId);

                var (subtotal, orderItems) = await BuildOrderWithItemsAsync(cart);
                var (coupon, finalTotal) = await CalculateDiscountAsync(customerId, dto.CouponCode, subtotal);

                var order = CreateOrderEntity(customerId, dto, orderItems, coupon, finalTotal, shippingSnapshot);

                await _orderRepository.AddAsync(order);
                cart.CartItems.Clear();

                await _unitOfWork.SaveChangesAsync();

                await _outBoxMessageService.CreateAndAddMessageAsync("OrderEmail", new { Email = customer.Email!, OrderId = order.Id });

                await _unitOfWork.SaveChangesAsync();
                await _unitOfWork.CommitTransactionAsync();

                _logger.LogInformation("Order {OrderId} placed successfully for CustomerId={CustomerId}, TotalPrice={TotalPrice}, ItemCount={ItemCount}",
                    order.Id, customerId, finalTotal, orderItems.Count);

                return OrderMapper.MapToDetailDto(order);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Order placement failed for CustomerId={CustomerId}. Transaction rolled back", customerId);
                await _unitOfWork.RollbackTransactionAsync();
                throw;
            }
        }


        private static void ValidateId(int id, string paramName)
        {
            if (id <= 0) throw new BadRequestException($"{paramName} must be greater than zero.");
        }

       
        private async Task<ShippingAddress> BuildShippingSnapshotAsync(int customerId, int customerAddressId)
        {
            var address = await _addressRepository.GetByIdAsync(customerAddressId)
                ?? throw new NotFoundException($"Address {customerAddressId} not found.");

            if (address.CustomerId != customerId)
                throw new ForbiddenException("The specified address does not belong to this customer.");

            return CreateShipping(address);
        }

        private static ShippingAddress CreateShipping(CustomerAddress address)
        {
            return new ShippingAddress
            {
                RecipientName = address.RecipientName,
                Phone = address.Phone,
                City = address.City,
                Street = address.Street,
                BuildingNumber = address.BuildingNumber,
                PostalCode = address.PostalCode,
            };
        }

        private async Task<Cart> ValidateCartAsync(int customerId)
        {
            var cart = await _cartRepository.GetCartWithItemsAsync(customerId);
            if (cart == null || !cart.CartItems.Any())
                throw new BadRequestException("Cart is empty. Add items before placing an order.");
            return cart;
        }

        private async Task<(decimal Subtotal, List<OrderItem> Items)> BuildOrderWithItemsAsync(Cart cart)
        {  
            var productIds = cart.CartItems.Select(ci => ci.ProductId).Distinct().ToList();

            var products = await _productRepository.GetProductsByIdsAsync(productIds);

            if (productIds.Count != products.Count)
            {
                var missingNames = productIds.Except(products.Select(p => p.Id));
                throw new NotFoundException($"Products with IDs {string.Join(", ", missingNames)} not found.");
            }

            var productQuantities = cart.CartItems.ToDictionary(i => i.ProductId, i => i.Quantity);

            if (!await _productRepository.UpdateStocksAsync(productQuantities))
            {
                _logger.LogWarning("Order placement aborted: Insufficient stock for product IDs: {ProductIds}", string.Join(", ", productIds));
                throw new BadRequestException("Insufficient stock for one or more products.");
            }

            var productsDict = products.ToDictionary(p => p.Id);

            decimal subtotal = 0;
            var items = new List<OrderItem>();

            foreach (var item in cart.CartItems)
            {
                var product = productsDict[item.ProductId];

                items.Add(new OrderItem
                {
                    ProductId = item.ProductId,
                    Quantity = item.Quantity,
                    UnitPrice = product.Price
                });

                subtotal += product.Price * item.Quantity;
            }

            return (subtotal, items);
        }

        private async Task<(CouponDto? Coupon, decimal FinalTotal)> CalculateDiscountAsync(int customerId, string? couponCode, decimal subtotal)
        {
            if (string.IsNullOrWhiteSpace(couponCode))
            {
                return (null, subtotal);
            }

            var coupon = await _couponService.ValidateAndGetCouponAsync(customerId, couponCode);

            decimal discount = coupon.DiscountType switch
            {
                DiscountType.Percentage => subtotal * (coupon.DiscountValue / 100m), // Percentage
                DiscountType.FixedAmount => coupon.DiscountValue,                    // FixedAmount
                _ => 0m
            };

            discount = Math.Min(discount, subtotal);


            return (coupon, subtotal - discount);
        }

        private static Order CreateOrderEntity(int customerId, PlaceOrderDto dto, List<OrderItem> items, CouponDto? coupon, decimal finalTotal, ShippingAddress shippingSnapshot)
        {
            Order order = CreateOrder(customerId, dto, items, finalTotal, shippingSnapshot);

            if (coupon != null)
            {
                order.CouponUsage = new CouponUsage
                {
                    CouponId = coupon.Id,
                    CustomerId = customerId,
                    UsedAt = DateTime.UtcNow
                };
                coupon.TimesUsed++;
            }

            return order;
        }

        private static Order CreateOrder(int customerId, PlaceOrderDto dto, List<OrderItem> items, decimal finalTotal, ShippingAddress shippingSnapshot)
        {
            return new Order
            {
                CustomerId = customerId,
                OrderDate = DateTime.UtcNow,
                TotalPrice = finalTotal,
                OrderItems = items,
                ShippingAddress = shippingSnapshot,
                Payment = new Payment
                {
                    Amount = finalTotal,
                    PaymentDate = DateTime.UtcNow,
                    Method = dto.PaymentMethod,
                    Status = (int)PaymentStatus.Pending
                },
                Shipment = new Shipment
                {
                    Status = (int)ShipmentStatus.Pending,
                    EstimatedDeliveryDate = DateTime.UtcNow.AddDays(5)
                }
            };
        }

        public async Task<bool> ConfirmPaymentAsync(int orderId, int userId, string paymentIntentId)
        {
            _logger.LogInformation("Processing payment confirmation for OrderId={OrderId}, UserId={UserId}, PaymentIntentId={PaymentIntentId}",
                orderId, userId, paymentIntentId);

            var order = await _orderRepository.GetOrderWithPaymentAndShipmentAsync(orderId, userId);

            if (order == null)
            {
                _logger.LogWarning("Payment confirmation failed. OrderId={OrderId} not found for UserId={UserId}", orderId, userId);
                return false;
            }

            order.OrderStatus = (int)OrderStatus.confirmed;

            if (order.Payment != null)
            {
                order.Payment.Status = (int)PaymentStatus.Completed;
                order.Payment.TransactionId = paymentIntentId;
                order.Payment.PaymentDate = DateTime.UtcNow;
            }

            if (order.Shipment == null)
            {
                order.Shipment = new Shipment
                {
                    OrderId = order.Id,
                    Status = (int)ShipmentStatus.Pending,
                    Carrier = "Global Express",
                    TrackingNumber = $"TRK-{Guid.NewGuid().ToString("N")[..8].ToUpper()}",
                    EstimatedDeliveryDate = DateTime.UtcNow.AddDays(3),
                    ShipmentDate = DateTime.UtcNow
                };
            }

            _orderRepository.Update(order);
            await _unitOfWork.SaveChangesAsync();

            _logger.LogInformation("Payment confirmed successfully for OrderId={OrderId}. OrderStatus set to Confirmed", orderId);
            return true;
        }
    }
}