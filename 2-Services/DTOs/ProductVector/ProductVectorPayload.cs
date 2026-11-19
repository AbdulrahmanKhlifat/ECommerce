public class ProductVectorPayload
{
    public int ProductId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string CategoryName { get; set; } = string.Empty;
    public decimal Price { get; set; }

    
    public string ToEmbeddingText()
    {
        return $"Product: {Name}. Category: {CategoryName}. Description: {Description}. Price: {Price:C}";
    }
}