using Qdrant.Client;
using Qdrant.Client.Grpc;

public class VectorDbService
{
    private readonly QdrantClient _qdrantClient;
    private const string CollectionName = "products";

    public VectorDbService()
    {
     
        _qdrantClient = new QdrantClient("localhost", 6334);
    }

    public async Task InitializeCollectionAsync()
    {
        
        var exists = await _qdrantClient.CollectionExistsAsync(CollectionName);
        if (!exists)
        {
            
            await _qdrantClient.CreateCollectionAsync(
                collectionName: CollectionName,
                vectorsConfig: new VectorParams
                {
                    Size = 1536, 
                    Distance = Distance.Cosine 
                });
        }
    }
}