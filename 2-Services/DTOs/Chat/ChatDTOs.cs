using System.ComponentModel.DataAnnotations;

namespace _2_Services.DTOs.Chat;

/// <summary>
/// Request model for RAG Chatbot inquiry.
/// </summary>
public class ChatRequest
{
    [Required(ErrorMessage = "Prompt is required.")]
    public string Prompt { get; set; } = string.Empty;

    /// <summary>
    /// Number of top similar products to retrieve from Qdrant vector database (default: 5).
    /// </summary>
    [Range(1, 20, ErrorMessage = "TopK must be between 1 and 20.")]
    public ulong TopK { get; set; } = 5;
}

/// <summary>
/// Information of a product retrieved from vector search.
/// </summary>
public class ChatProductDto
{
    public int ProductId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string CategoryName { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public decimal Price { get; set; }
    public float Score { get; set; }
}

/// <summary>
/// Response model for RAG Chatbot inquiry.
/// </summary>
public class ChatResponse
{
    public string Answer { get; set; } = string.Empty;
    public List<ChatProductDto> SourceProducts { get; set; } = new();
}
