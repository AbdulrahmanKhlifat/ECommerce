using _2_Services.DTOs.Chat;
using _2_Services.Interfaces;
using _2_Services.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace _3_RestfulAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ProductRagController : ControllerBase
    {
        private readonly ProductRagService _ragService;
        private readonly IProductService _productService;

        public ProductRagController(ProductRagService ragService, IProductService productService)
        {
            _ragService = ragService;
            _productService = productService;
        }

        [HttpPost("sync-vectors")]
        [Authorize(Roles = "admin")]
        [EnableRateLimiting("LowCostLimiter")]
        public async Task<IActionResult> SyncProductsToVectorDb(CancellationToken cancellationToken)
        {
            var products = await _productService.GetAllProductsAsync();

            var vectorPayloads = products.Select(p => new ProductVectorPayload
            {
                ProductId = p.Id,
                Name = p.Name,
                CategoryName = p.CategoryName, 
                Price = p.Price
            }).ToList();

            await _ragService.SyncAllProductsToQdrantAsync(vectorPayloads, cancellationToken: cancellationToken);

            return Ok(new { Message = $"Successfully synced {vectorPayloads.Count} products to Qdrant Vector DB!" });
        }

        /// <summary>
        /// Answers customer queries grounded in retrieved product catalog vectors from Qdrant or SQL database.
        /// Publicly accessible to store shoppers with rate limiting protection.
        /// </summary>
        [HttpPost("chat")]
        [AllowAnonymous]
        [EnableRateLimiting("HighCostLimiter")]
        public async Task<ActionResult<ChatResponse>> Chat(
            [FromBody] ChatRequest request,
            CancellationToken cancellationToken)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var response = await _ragService.ChatAsync(
                userPrompt: request.Prompt,
                topK: request.TopK,
                cancellationToken: cancellationToken);

            return Ok(response);
        }
    }
}