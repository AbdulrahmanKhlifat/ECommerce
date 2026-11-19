using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Serialization;
using _1_Repository.Interfaces;
using _2_Services.DTOs.Chat;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Qdrant.Client;
using Qdrant.Client.Grpc;

namespace _2_Services.Services;


public class ProductRagService
{
    private readonly QdrantClient _qdrantClient;
    private readonly HttpClient _httpClient;
    private readonly ILogger<ProductRagService> _logger;
    private readonly IProductRepository? _productRepository;
    private readonly string _apiKey;
    private readonly string _embeddingModel;
    private readonly string _chatModel;
    private const string DefaultCollectionName = "products";
    private const int ExpectedDimension = 768;

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "a", "an", "the", "and", "or", "in", "on", "at", "for", "with", "by", "from",
        "to", "is", "are", "was", "were", "be", "this", "that", "it", "of", "can",
        "you", "show", "me", "what", "how", "give", "find", "get", "looking", "want",
        "need", "recommend", "suggest", "best", "good", "some", "any", "please", "help"
    };

    public string CollectionName { get; }

    public ProductRagService(
        IConfiguration config,
        HttpClient httpClient,
        ILogger<ProductRagService> logger,
        IProductRepository? productRepository = null,
        QdrantClient? qdrantClient = null)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _productRepository = productRepository;

        // 1. Resolve & Validate Gemini API Configuration
        _apiKey = config["Gemini:ApiKey"]
            ?? throw new InvalidOperationException("Gemini API key is not configured. Please set 'Gemini:ApiKey' in configuration.");

        // gemini-embedding-001 is standard on Gemini REST API v1beta
        _embeddingModel = config["Gemini:EmbeddingModel"] ?? "gemini-embedding-001";
        _chatModel = config["Gemini:ChatModel"] ?? "gemini-3.6-flash";
        CollectionName = config["Qdrant:CollectionName"] ?? DefaultCollectionName;

        // 2. Resolve Qdrant Client (support DI injection or fallback to configuration)
        if (qdrantClient != null)
        {
            _qdrantClient = qdrantClient;
        }
        else
        {
            var host = config["Qdrant:Host"] ?? "localhost";
            var port = int.TryParse(config["Qdrant:Port"], out var parsedPort) ? parsedPort : 6334;
            var qdrantApiKey = config["Qdrant:ApiKey"];
            var useHttps = bool.TryParse(config["Qdrant:UseHttps"], out var parsedHttps) && parsedHttps;

            _qdrantClient = new QdrantClient(host: host, port: port, https: useHttps, apiKey: qdrantApiKey);
        }
    }

    /// <summary>
    /// Ensures that the target Qdrant collection exists with the required 768-dim Cosine vector configuration.
    /// </summary>
    public async Task EnsureCollectionExistsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            _logger.LogInformation("Checking if Qdrant collection '{Collection}' exists...", CollectionName);
            var exists = await _qdrantClient.CollectionExistsAsync(CollectionName, cancellationToken);
            if (!exists)
            {
                _logger.LogInformation("Creating Qdrant collection '{Collection}' with dimension {Dim} and Cosine distance.", CollectionName, ExpectedDimension);
                await _qdrantClient.CreateCollectionAsync(
                    collectionName: CollectionName,
                    vectorsConfig: new VectorParams
                    {
                        Size = (ulong)ExpectedDimension,
                        Distance = Distance.Cosine
                    },
                    cancellationToken: cancellationToken);

                _logger.LogInformation("Qdrant collection '{Collection}' successfully created.", CollectionName);
            }
            else
            {
                _logger.LogDebug("Qdrant collection '{Collection}' already exists.", CollectionName);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to verify or create Qdrant collection '{Collection}'.", CollectionName);
            throw;
        }
    }

    /// <summary>
    /// Generates a 768-dimensional embedding vector for the provided text using Google Gemini REST API.
    /// </summary>
    public async Task<float[]> GenerateEmbeddingAsync(string textToEmbed, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(textToEmbed))
        {
            throw new ArgumentException("Text for embedding cannot be null, empty, or whitespace.", nameof(textToEmbed));
        }

        try
        {
            return await CallGeminiEmbedContentAsync(_embeddingModel, textToEmbed, cancellationToken);
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // Automatic fallback between gemini-embedding-001 and gemini-embedding-2
            var fallbackModel = _embeddingModel.Contains("embedding-2") ? "gemini-embedding-001" : "gemini-embedding-2";
            _logger.LogWarning("Embedding model '{Primary}' returned 404. Automatically falling back to '{Fallback}'.", _embeddingModel, fallbackModel);
            return await CallGeminiEmbedContentAsync(fallbackModel, textToEmbed, cancellationToken);
        }
    }

    private async Task<float[]> CallGeminiEmbedContentAsync(string model, string textToEmbed, CancellationToken cancellationToken)
    {
        var rawModel = model.StartsWith("models/") ? model.Substring(7) : model;
        // Normalize legacy or deprecated model names
        if (rawModel.Equals("embedding-001", StringComparison.OrdinalIgnoreCase) ||
            rawModel.Equals("text-embedding-004", StringComparison.OrdinalIgnoreCase))
        {
            rawModel = "gemini-embedding-001";
        }
        var fullModelName = $"models/{rawModel}";

        // 1. تعديل المسار لضمان دمج الـ Endpoint بشكل صحيح
        var requestUrl = $"https://generativelanguage.googleapis.com/v1beta/{fullModelName}:embedContent";

        // 2. Request body with outputDimensionality matching Qdrant (768)
        var requestBody = new
        {
            model = fullModelName,
            content = new
            {
                parts = new[]
                {
                    new { text = textToEmbed }
                }
            },
            outputDimensionality = ExpectedDimension
        };

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, requestUrl)
        {
            Content = JsonContent.Create(requestBody)
        };

        // Standard Gemini API authentication header
        httpRequest.Headers.Add("x-goog-api-key", _apiKey);

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(httpRequest, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Network failure while sending embedding request to Gemini API ({Model}).", rawModel);
            throw new HttpRequestException($"Failed to reach Gemini API endpoint: {ex.Message}", ex);
        }

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogError("Gemini API call ({Model}) failed with status {StatusCode}. Response: {ResponseContent}", rawModel, response.StatusCode, errorContent);
            throw new HttpRequestException($"Gemini API error [{response.StatusCode}]: {errorContent}", null, response.StatusCode);
        }

        var result = await response.Content.ReadFromJsonAsync<GeminiEmbeddingResponse>(cancellationToken: cancellationToken);

        var vector = result?.Embedding?.Values;
        if (vector == null || vector.Length == 0)
        {
            _logger.LogError("Gemini API returned an empty or missing embedding vector for model {Model}.", rawModel);
            throw new InvalidOperationException($"Failed to extract valid embedding values from Gemini API response ({rawModel}).");
        }

        if (vector.Length != ExpectedDimension)
        {
            _logger.LogWarning("Embedding dimension mismatch for {Model}. Expected {Expected}, received {Received}.", rawModel, ExpectedDimension, vector.Length);
        }

        return vector;
    }


    public async Task UpsertProductVectorAsync(ProductVectorPayload product, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(product);

        if (product.ProductId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(product.ProductId), "ProductId must be a positive integer.");
        }

        string textToEmbed = product.ToEmbeddingText();
        float[] vectorValues = await GenerateEmbeddingAsync(textToEmbed, cancellationToken);

        var point = CreatePointStruct(product, vectorValues);

        try
        {
            await _qdrantClient.UpsertAsync(CollectionName, new[] { point }, cancellationToken: cancellationToken);
            _logger.LogDebug("Successfully upserted product {ProductId} into Qdrant.", product.ProductId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to upsert product {ProductId} into Qdrant collection '{Collection}'.", product.ProductId, CollectionName);
            throw;
        }
    }

    
    public async Task SyncAllProductsToQdrantAsync(
        IEnumerable<ProductVectorPayload> products,
        int batchSize = 100,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(products);

        await EnsureCollectionExistsAsync(cancellationToken);

        var productList = products.ToList();
        if (productList.Count == 0)
        {
            _logger.LogInformation("No products provided for Qdrant synchronization.");
            return;
        }

        _logger.LogInformation("Starting vector synchronization for {Count} products (Batch size: {BatchSize})...", productList.Count, batchSize);

        var batchPoints = new List<PointStruct>(batchSize);
        int processedCount = 0;

        foreach (var product in productList)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (product.ProductId <= 0)
            {
                _logger.LogWarning("Skipping product with invalid ProductId: {ProductId}", product.ProductId);
                continue;
            }

            try
            {
                string textToEmbed = product.ToEmbeddingText();
                float[] vector = await GenerateEmbeddingAsync(textToEmbed, cancellationToken);
                batchPoints.Add(CreatePointStruct(product, vector));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to generate embedding for Product {ProductId} ({ProductName}). Skipping.", product.ProductId, product.Name);
                continue;
            }

            if (batchPoints.Count >= batchSize)
            {
                await UpsertBatchAsync(batchPoints, cancellationToken);
                processedCount += batchPoints.Count;
                _logger.LogInformation("Synced {Processed}/{Total} products to Qdrant...", processedCount, productList.Count);
                batchPoints.Clear();
            }
        }

        if (batchPoints.Count > 0)
        {
            await UpsertBatchAsync(batchPoints, cancellationToken);
            processedCount += batchPoints.Count;
            _logger.LogInformation("Completed synchronization: {Processed}/{Total} products successfully indexed in Qdrant.", processedCount, productList.Count);
            batchPoints.Clear();
        }
    }

    private async Task UpsertBatchAsync(IReadOnlyList<PointStruct> points, CancellationToken cancellationToken)
    {
        try
        {
            await _qdrantClient.UpsertAsync(CollectionName, points, cancellationToken: cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to upsert batch of {Count} points to Qdrant collection '{Collection}'.", points.Count, CollectionName);
            throw;
        }
    }

    /// <summary>
    /// Constructs a Qdrant PointStruct with safely typed metadata payload.
    /// </summary>
    private static PointStruct CreatePointStruct(ProductVectorPayload product, float[] vectorValues)
    {
        var point = new PointStruct
        {
            Id = (ulong)product.ProductId,
            Vectors = vectorValues
        };

        // Populate payload with null-safe values and correct types
        point.Payload.Add("ProductId", product.ProductId);
        point.Payload.Add("Name", product.Name ?? string.Empty);
        point.Payload.Add("CategoryName", product.CategoryName ?? string.Empty);
        point.Payload.Add("Description", product.Description ?? string.Empty);

        // Qdrant Protobuf doesn't support C# decimal; cast to double for accurate numeric storage
        point.Payload.Add("Price", (double)product.Price);

        return point;
    }

    /// <summary>
    /// Answers a customer inquiry using RAG: embeds the query, searches Qdrant vector database (or falls back
    /// to the database catalog), and generates an accurate grounded response using Google Gemini.
    /// </summary>
    public async Task<ChatResponse> ChatAsync(
        string userPrompt,
        ulong topK = 5,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(userPrompt))
        {
            throw new ArgumentException("Prompt cannot be empty or whitespace.", nameof(userPrompt));
        }

        int targetLimit = (int)Math.Clamp(topK, 1, 10);
        _logger.LogInformation("Processing RAG chat inquiry: '{Prompt}' (TargetLimit: {TargetLimit})", userPrompt, targetLimit);

        var retrievedProducts = new List<ChatProductDto>();
        var seenProductIds = new HashSet<int>();

        // 1. Try vector similarity search with Qdrant first
        try
        {
            float[] queryVector = await GenerateEmbeddingAsync(userPrompt, cancellationToken);

#pragma warning disable CS0618
            var searchResults = await _qdrantClient.SearchAsync(
                collectionName: CollectionName,
                vector: queryVector,
                limit: (ulong)targetLimit,
                cancellationToken: cancellationToken);
#pragma warning restore CS0618

            if (searchResults != null)
            {
                foreach (var hit in searchResults)
                {
                    int productId = hit.Payload.TryGetValue("ProductId", out var pidVal)
                        ? (int)pidVal.IntegerValue
                        : (int)hit.Id.Num;

                    if (seenProductIds.Add(productId))
                    {
                        string name = hit.Payload.TryGetValue("Name", out var nameVal) ? nameVal.StringValue : string.Empty;
                        string categoryName = hit.Payload.TryGetValue("CategoryName", out var catVal) ? catVal.StringValue : string.Empty;
                        string description = hit.Payload.TryGetValue("Description", out var descVal) ? descVal.StringValue : string.Empty;
                        decimal price = hit.Payload.TryGetValue("Price", out var priceVal) ? (decimal)priceVal.DoubleValue : 0m;

                        retrievedProducts.Add(new ChatProductDto
                        {
                            ProductId = productId,
                            Name = name,
                            CategoryName = categoryName,
                            Description = description,
                            Price = price,
                            Score = hit.Score
                        });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Qdrant similarity search unavailable ({Message}). Using SQL catalog search.", ex.Message);
        }

        // 2. Hybrid Fallback & Enrichment using Database Catalog
        if (_productRepository != null && retrievedProducts.Count < targetLimit)
        {
            try
            {
                var allDbProducts = await _productRepository.GetAllAsync();
                var promptLower = userPrompt.ToLowerInvariant();

                var tokens = promptLower
                    .Split(new[] { ' ', ',', '.', '?', '!', ';', ':', '-', '/', '\\', '"', '\'' }, StringSplitOptions.RemoveEmptyEntries)
                    .Where(t => t.Length > 2 && !StopWords.Contains(t))
                    .ToList();

                var scored = allDbProducts
                    .Where(p => p.IsActive && !seenProductIds.Contains(p.Id))
                    .Select(p =>
                    {
                        float score = 0f;
                        var nameLower = (p.Name ?? string.Empty).ToLowerInvariant();
                        var catLower = (p.Category?.Name ?? string.Empty).ToLowerInvariant();

                        // Exact substring match bonus
                        if (tokens.Count > 0 && !string.IsNullOrWhiteSpace(nameLower) && promptLower.IndexOf(nameLower, StringComparison.OrdinalIgnoreCase) >= 0) score += 10f;
                        if (tokens.Count > 0 && !string.IsNullOrWhiteSpace(catLower) && promptLower.IndexOf(catLower, StringComparison.OrdinalIgnoreCase) >= 0) score += 6f;

                        foreach (var token in tokens)
                        {
                            if (!string.IsNullOrWhiteSpace(token))
                            {
                                if (nameLower.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0) score += 4f;
                                if (catLower.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0) score += 3f;
                            }
                        }

                        // Budget keyword matching (e.g. "under 500", "under 1000", "cheap")
                        if (promptLower.Contains("under 300") && p.Price <= 300m) score += 3f;
                        if (promptLower.Contains("under 500") && p.Price <= 500m) score += 3f;
                        if (promptLower.Contains("under 1000") && p.Price <= 1000m) score += 3f;
                        if (promptLower.Contains("under 2000") && p.Price <= 2000m) score += 3f;

                        return new { Product = p, Score = score, CatName = catLower };
                    })
                    .OrderByDescending(x => x.Score)
                    .ThenByDescending(x => x.Product.Stock)
                    .ToList();

                var matched = scored.Where(x => x.Score > 0).Take(targetLimit - retrievedProducts.Count).ToList();

                // If user asked a generic inquiry (e.g., "What do you sell?", "Show me recommendations")
                if (retrievedProducts.Count == 0 && matched.Count == 0)
                {
                    matched = scored.Take(targetLimit).ToList();
                }

                foreach (var item in matched)
                {
                    if (seenProductIds.Add(item.Product.Id))
                    {
                        var catName = item.Product.Category?.Name ?? "General";
                        retrievedProducts.Add(new ChatProductDto
                        {
                            ProductId = item.Product.Id,
                            Name = item.Product.Name,
                            CategoryName = catName,
                            Description = $"In Stock: {item.Product.Stock} units | Price: ${item.Product.Price:F2}",
                            Price = item.Product.Price,
                            Score = item.Score > 0 ? Math.Min(0.95f, 0.5f + (item.Score * 0.05f)) : 0.5f
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to query SQL database products for catalog context.");
            }
        }

        // 3. Construct Grounded Context
        var sb = new StringBuilder();
        if (retrievedProducts.Count == 0)
        {
            sb.AppendLine("No specific products found matching the query in the catalog.");
        }
        else
        {
            sb.AppendLine("Available Products in ShopNest Catalog:");
            for (int i = 0; i < retrievedProducts.Count; i++)
            {
                var p = retrievedProducts[i];
                sb.AppendLine($"[Product #{i + 1}] ID: {p.ProductId} | Name: {p.Name} | Category: {p.CategoryName} | Price: ${p.Price:F2} | Link: /product/{p.ProductId}");
                if (!string.IsNullOrWhiteSpace(p.Description))
                {
                    sb.AppendLine($"   Details: {p.Description}");
                }
            }
        }

        sb.AppendLine();
        sb.AppendLine("ShopNest Store Policies & Perks:");
        sb.AppendLine("- Shipping: FREE shipping on orders over $99. Flat rate $15 for orders under $99.");
        sb.AppendLine("- Active Coupons: SAVE15 (15% off), WELCOME10 ($10 off), BLACKFRIDAY (25% off).");
        sb.AppendLine("- Returns: 30-day hassle-free return and exchange policy.");
        sb.AppendLine("- Security: Encrypted 2FA authentication for accounts and transactions.");

        string contextText = sb.ToString();

        // 4. Generate grounded answer via Gemini
        string answer = await GenerateGroundedAnswerAsync(userPrompt, contextText, cancellationToken);

        return new ChatResponse
        {
            Answer = answer,
            SourceProducts = retrievedProducts
        };
    }

    /// <summary>
    /// Calls Gemini text generation API to generate a helpful shopping assistant response grounded strictly in retrieved context.
    /// </summary>
    public async Task<string> GenerateGroundedAnswerAsync(
        string userPrompt,
        string contextText,
        CancellationToken cancellationToken = default)
    {
        // Resilient model fallback chain
        var candidateModels = new[] { _chatModel, "gemini-flash-lite-latest", "gemini-3.1-flash-lite" };

        foreach (var model in candidateModels.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                return await CallGeminiGenerateContentAsync(model, userPrompt, contextText, cancellationToken);
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound ||
                                                 ex.StatusCode == System.Net.HttpStatusCode.ServiceUnavailable)
            {
                _logger.LogWarning("Chat model '{Model}' failed with status {StatusCode}. Trying next fallback model...", model, ex.StatusCode);
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Chat model '{Model}' failed: {Message}. Trying next fallback model...", model, ex.Message);
            }
        }

        return "I'm here to help you shop at ShopNest! Feel free to ask about any product in our store, current discounts like **SAVE15** or **BLACKFRIDAY**, or shipping policies!";
    }

    private async Task<string> CallGeminiGenerateContentAsync(
        string model,
        string userPrompt,
        string contextText,
        CancellationToken cancellationToken)
    {
        var rawChatModel = model.StartsWith("models/") ? model.Substring(7) : model;
        // Normalize any retired model names
        if (rawChatModel.Equals("gemini-2.0-flash", StringComparison.OrdinalIgnoreCase) ||
            rawChatModel.Equals("gemini-1.5-flash", StringComparison.OrdinalIgnoreCase))
        {
            rawChatModel = "gemini-3.6-flash";
        }
        var requestUrl = $"https://generativelanguage.googleapis.com/v1beta/models/{rawChatModel}:generateContent";

        var requestBody = new
        {
            system_instruction = new
            {
                parts = new[]
                {
                    new
                    {
                        text = "You are the expert, friendly, and helpful AI Shopping Assistant for ShopNest E-Commerce Store.\n" +
                               "Your mission is to help shoppers find, compare, and choose products from our catalog, and answer questions about orders, shipping, and coupons.\n\n" +
                               "CRITICAL ACCURACY & GROUNDING RULES:\n" +
                               "1. Base product recommendations, specifications, and prices strictly on the provided 'Store Catalog Context'.\n" +
                               "2. For every recommended product, always format it clearly:\n" +
                               "   - **Product Name** in bold with its exact price (e.g., **Apple iPhone 15 Pro** - $999.00)\n" +
                               "   - Category & key highlight\n" +
                               "   - Markdown link to the product: [View Product Details](/product/{ID})\n" +
                               "3. If the user asks for a product not in our catalog, politely state that we don't currently carry that exact model, and suggest the best matching alternatives from our catalog.\n" +
                               "4. Answer store policy questions accurately using the provided perks (Free shipping over $99, Coupons SAVE15, WELCOME10, BLACKFRIDAY, 30-day returns).\n" +
                               "5. Format responses with clean Markdown, bullet points, and welcoming emojis for optimal readability.\n" +
                               "6. Deliver your final response directly to the customer. Never output chain-of-thought, meta-commentary, or internal notes."
                    }
                }
            },
            contents = new[]
            {
                new
                {
                    role = "user",
                    parts = new[]
                    {
                        new
                        {
                            text = $"Customer Inquiry:\n{userPrompt}\n\nStore Catalog Context:\n{contextText}"
                        }
                    }
                }
            },
            generationConfig = new
            {
                temperature = 0.2,
                maxOutputTokens = 2048,
                thinkingConfig = new
                {
                    thinkingBudget = 0
                }
            }
        };

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, requestUrl)
        {
            Content = JsonContent.Create(requestBody)
        };

        httpRequest.Headers.Add("x-goog-api-key", _apiKey);

        HttpResponseMessage response;
        try
        {
            response = await _httpClient.SendAsync(httpRequest, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Network failure while calling Gemini Chat API endpoint ({Model}).", rawChatModel);
            throw new HttpRequestException($"Failed to reach Gemini Chat API endpoint: {ex.Message}", ex);
        }

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogError("Gemini Chat API call ({Model}) failed with status {StatusCode}. Response: {ResponseContent}", rawChatModel, response.StatusCode, errorContent);
            throw new HttpRequestException($"Gemini Chat API error [{response.StatusCode}]: {errorContent}", null, response.StatusCode);
        }

        var result = await response.Content.ReadFromJsonAsync<GeminiGenerateContentResponse>(cancellationToken: cancellationToken);
        var parts = result?.Candidates?.FirstOrDefault()?.Content?.Parts;
        var answerText = parts != null
            ? string.Join("", parts.Where(p => !string.IsNullOrWhiteSpace(p.Text)).Select(p => p.Text))
            : null;

        if (string.IsNullOrWhiteSpace(answerText))
        {
            _logger.LogWarning("Gemini Chat API returned an empty text response for model {Model}.", rawChatModel);
            return "I'm here to help you find the best products at ShopNest! What are you looking to buy today?";
        }

        return answerText.Trim();
    }

    #region Gemini API Models
    private sealed class GeminiEmbeddingResponse
    {
        [JsonPropertyName("embedding")]
        public EmbeddingData? Embedding { get; set; }
    }

    private sealed class EmbeddingData
    {
        [JsonPropertyName("values")]
        public float[]? Values { get; set; }
    }

    private sealed class GeminiGenerateContentResponse
    {
        [JsonPropertyName("candidates")]
        public List<Candidate>? Candidates { get; set; }
    }

    private sealed class Candidate
    {
        [JsonPropertyName("content")]
        public ContentData? Content { get; set; }

        [JsonPropertyName("finishReason")]
        public string? FinishReason { get; set; }
    }

    private sealed class ContentData
    {
        [JsonPropertyName("parts")]
        public List<PartData>? Parts { get; set; }

        [JsonPropertyName("role")]
        public string? Role { get; set; }
    }

    private sealed class PartData
    {
        [JsonPropertyName("text")]
        public string? Text { get; set; }
    }
    #endregion
}