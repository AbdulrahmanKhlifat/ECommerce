using _1_Repository.Data;
using _1_Repository.Interfaces;
using _2_Services.Interfaces;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace _2_Services.Services
{
    public class ShipmentService : IShipmentService
    {
        private readonly IShipmentRepository _shipmentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<ShipmentService> _logger;

        public ShipmentService(
            IShipmentRepository shipmentRepository,
            IUnitOfWork unitOfWork,
            ILogger<ShipmentService> logger)
        {
            _shipmentRepository = shipmentRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task<ShipmentDto?> GetShipmentByIdAsync(int id)
        {
            if (id <= 0)
                throw new BadRequestException("Shipment ID must be greater than zero.");

            var shipment = await _shipmentRepository.GetByIdAsync(id);

            if (shipment == null)
                throw new NotFoundException($"Shipment with ID {id} not found.");

            return ShipmentMapper.MapToDto(shipment);
        }

        public async Task<ShipmentDto?> GetShipmentByOrderIdAsync(int orderId)
        {
            if (orderId <= 0)
                throw new BadRequestException("Order ID must be greater than zero.");

            var shipment = await _shipmentRepository.GetByOrderIdAsync(orderId);
            if (shipment == null)
                throw new NotFoundException($"Shipment for Order ID {orderId} not found.");

            return ShipmentMapper.MapToDto(shipment);
        }

        public async Task<ShipmentDto?> UpdateShipmentStatusAsync(int id, UpdateShipmentDto dto)
        {
            if (id <= 0)
                throw new BadRequestException("Shipment ID must be greater than zero.");

            if (dto == null)
                throw new BadRequestException("Shipment update data is required.");

            var shipment = await _shipmentRepository.GetByIdAsync(id);
            if (shipment == null)
                throw new NotFoundException($"Shipment with ID {id} not found.");

            shipment.Status = (int)dto.Status;
            UpdateShipmentDto(dto, shipment);

            _shipmentRepository.Update(shipment);
            await _unitOfWork.SaveChangesAsync();

            _logger.LogInformation("Shipment updated: ShipmentId={ShipmentId}, OrderId={OrderId}, Status={Status}, TrackingNumber={TrackingNumber}",
                id, shipment.OrderId, shipment.Status, shipment.TrackingNumber);

            return ShipmentMapper.MapToDto(shipment);
        }

        private static void UpdateShipmentDto(UpdateShipmentDto dto, Shipment shipment)
        {
            if (dto.TrackingNumber != null)
                shipment.TrackingNumber = dto.TrackingNumber;

            if (dto.Carrier != null)
                shipment.Carrier = dto.Carrier;

            if (dto.ShipmentDate.HasValue)
                shipment.ShipmentDate = dto.ShipmentDate;

            if (dto.EstimatedDeliveryDate.HasValue)
                shipment.EstimatedDeliveryDate = dto.EstimatedDeliveryDate;

            if (dto.ActualDeliveryDate.HasValue)
                shipment.ActualDeliveryDate = dto.ActualDeliveryDate;
        }

    }
}
