using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace _1_Repository.Migrations
{
    /// <inheritdoc />
    public partial class AddUniqueIndex_Cart_CustomerId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Step 1: Remove duplicate carts — keep only the most recent cart per customer.
            // This is required before a UNIQUE index can be created on CustomerId.
            migrationBuilder.Sql(@"
                DELETE FROM [Carts]
                WHERE [Id] NOT IN (
                    SELECT MAX([Id])
                    FROM [Carts]
                    GROUP BY [CustomerId]
                );
            ");

            // Step 2: The TPT migration left a non-unique IX_Carts_CustomerId behind.
            // Drop it first, then recreate it as UNIQUE.
            migrationBuilder.DropIndex(
                name: "IX_Carts_CustomerId",
                table: "Carts");

            migrationBuilder.CreateIndex(
                name: "IX_Carts_CustomerId",
                table: "Carts",
                column: "CustomerId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Carts_CustomerId",
                table: "Carts");

            migrationBuilder.CreateIndex(
                name: "IX_Carts_CustomerId",
                table: "Carts",
                column: "CustomerId");
        }
    }
}
