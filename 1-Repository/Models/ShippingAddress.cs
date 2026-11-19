using System.ComponentModel.DataAnnotations.Schema;

namespace _1_Repository.Data
{
    [Table("ShippingAddresses")]
    public class ShippingAddress
    {
        public int Id { get; set; }

        [Column("ShippingRecipientName")]
        public string RecipientName { get; set; } = null!;

        [Column("ShippingPhone")]
        public string Phone { get; set; } = null!;

        [Column("ShippingCity")]
        public string City { get; set; } = null!;

        [Column("ShippingStreet")]
        public string Street { get; set; } = null!;

        [Column("ShippingBuildingNumber")]
        public string? BuildingNumber { get; set; }

        [Column("ShippingPostalCode")]
        public string? PostalCode { get; set; }

        // Navigation back to the owning Order (one-to-one)
        public Order Order { get; set; } = null!;
    }
}