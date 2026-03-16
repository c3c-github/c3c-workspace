const axios = require('axios');

/**
 * Serviço para interface com a API Microsoft Graph (SharePoint)
 */
class MicrosoftGraphService {
    constructor() {
        this.clientId = process.env.AZURE_CLIENT_ID;
        this.clientSecret = process.env.AZURE_CLIENT_SECRET;
        this.tenantId = process.env.AZURE_TENANT_ID;
        
        // Novo: Usando Site ID (Mais estável que Drive ID)
        this.siteId = 'c3csoftware.sharepoint.com,3ae9d296-a1a2-456c-8d89-93b9bc122943,5db5632f-1ac4-4069-9a02-9547d8192e56';
        this.basePath = process.env.SHAREPOINT_BASE_PATH || 'NOTAS FISCAIS 2026 - COLABORADORES';
        
        this.token = null;
        this.tokenExpires = 0;
    }

    /**
     * Obtém Token de acesso via Client Credentials para o Microsoft Graph
     */
    async getAccessToken() {
        if (this.token && Date.now() < this.tokenExpires) return this.token;

        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('client_secret', this.clientSecret);
        params.append('grant_type', 'client_credentials');
        params.append('scope', 'https://graph.microsoft.com/.default');

        const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
        
        try {
            const res = await axios.post(url, params);
            this.token = res.data.access_token;
            this.tokenExpires = Date.now() + (res.data.expires_in * 1000) - 60000;
            return this.token;
        } catch (e) {
            console.error("❌ Erro ao obter token Microsoft Graph:", e.response?.data || e.message);
            throw new Error("Falha na autenticação com Microsoft Graph.");
        }
    }

    /**
     * Garante que uma estrutura de pastas existe no SharePoint
     */
    async ensureFolderExists(path) {
        console.log(`[Graph] 🔍 Verificando caminho: ${path}`);
        const token = await this.getAccessToken();
        const segments = path.split('/').filter(s => s);
        let currentPath = this.basePath;

        // URL base usando o Site ID e acessando o "drive" padrão (biblioteca Documentos)
        const baseUrl = `https://graph.microsoft.com/v1.0/sites/${this.siteId}/drive/root`;

        for (const segment of segments) {
            const fullPath = `${currentPath}/${segment}`;
            console.log(`[Graph] 📁 Validando segmento: ${fullPath}`);
            try {
                await axios.get(
                    `${baseUrl}:/${encodeURIComponent(fullPath)}`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                currentPath = fullPath;
            } catch (e) {
                if (e.response?.status === 404) {
                    console.log(`[Graph] ➕ Criando pasta: ${segment} em ${currentPath}`);
                    const createUrl = `${baseUrl}:/${encodeURIComponent(currentPath)}:/children`;
                    try {
                        await axios.post(
                            createUrl,
                            {
                                name: segment,
                                folder: {},
                                "@microsoft.graph.conflictBehavior": "fail"
                            },
                            { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
                        );
                    } catch (createErr) {
                        // Se der 409, significa que outra thread criou a pasta simultaneamente, podemos ignorar e seguir
                        if (createErr.response?.status !== 409) throw createErr;
                        console.log(`[Graph] ℹ️ Pasta ${segment} já existia (concorrência).`);
                    }
                    currentPath = fullPath;
                } else {
                    console.error(`[Graph] ❌ Erro ao validar/criar pasta ${segment}:`, e.response?.data || e.message);
                    throw e;
                }
            }
        }
        return currentPath;
    }

    async uploadFile(path, fileName, buffer) {
        const token = await this.getAccessToken();
        const fullFilePath = `${path}/${fileName}`;
        console.log(`[Graph] 📤 Iniciando upload: ${fullFilePath}`);
        
        const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${this.siteId}/drive/root:/${encodeURIComponent(fullFilePath)}:/content`;
        
        try {
            await axios.put(uploadUrl, buffer, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/octet-stream'
                }
            });
            
            console.log(`[Graph] ✅ Upload concluído: ${fileName}`);
            return true;
        } catch (e) {
            console.error("[Graph] ❌ Erro no upload SharePoint:", e.response?.data || e.message);
            throw new Error(`Falha ao enviar arquivo para o SharePoint: ${fileName}`);
        }
    }
}

module.exports = new MicrosoftGraphService();
