using _1_Repository.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace _1_Repository.Config
{
    public class CartConfiguration : IEntityTypeConfiguration<Cart>
    {
        public void Configure(EntityTypeBuilder<Cart> builder)
        {
            builder.HasKey(c => c.Id);

            builder.Property(c => c.Id)
                .ValueGeneratedOnAdd();

            builder.HasOne(c => c.Customer)
                .WithOne(cust => cust.Cart)
                .HasForeignKey<Cart>(c => c.CustomerId)
                .OnDelete(DeleteBehavior.Cascade);

            // Explicit unique index: enforces one-to-one at the DB level.
            // EF Core already implies this from WithOne(), but declaring it
            // explicitly makes the constraint self-documenting and intention clear.
            builder.HasIndex(c => c.CustomerId)
                .IsUnique();
        }
    }
}
