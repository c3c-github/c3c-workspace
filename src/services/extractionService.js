const axios = require('axios');

/**
 * Serviço para interface com a API de Extração Gemini 2.5 Flash
 */
class ExtractionService {
    constructor() {
        this.clientId = process.env.AZURE_CLIENT_ID;
        this.clientSecret = process.env.AZURE_CLIENT_SECRET;
        this.tenantId = process.env.AZURE_TENANT_ID;
        this.apiUrl = 'https://c3c-api-arquivos-46116884f40b.herokuapp.com/api/extrair';
        this.token = null;
        this.tokenExpires = 0;
    }

    /**
     * Obtém Token de acesso via Client Credentials na Azure
     */
    async getAccessToken() {
        if (this.token && Date.now() < this.tokenExpires) return this.token;

        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('client_secret', this.clientSecret);
        params.append('grant_type', 'client_credentials');
        params.append('scope', `${this.clientId}/.default`);

        const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
        
        try {
            const res = await axios.post(url, params);
            this.token = res.data.access_token;
            this.tokenExpires = Date.now() + (res.data.expires_in * 1000) - 60000; // 1 min de margem
            return this.token;
        } catch (e) {
            console.error("❌ Erro ao obter token Azure:", e.response?.data || e.message);
            throw new Error("Falha na autenticação com serviço de extração.");
        }
    }

    /**
     * Envia arquivo para extração de dados via IA
     * @param {string} base64 Conteúdo do arquivo
     * @param {string} mimeType MimeType (application/pdf, image/jpeg, etc)
     */
    async extrairDadosNota(base64, mimeType) {
        const token = await this.getAccessToken();

        const payload = {
            base64: base64,
            mimeType: mimeType,
            contexto: "Extraia os dados desta nota fiscal de serviço (entrada). Foque em identificar os dados do prestador e valores totais.",
            contrato: [
                { nomeCampo: "numeroNota", tipo: "texto", contexto: "Número da nota fiscal ou número do documento" },
                { nomeCampo: "valorTotal", tipo: "númerico", contexto: "Valor líquido ou total da nota para pagamento" },
                { nomeCampo: "dataEmissao", tipo: "texto", contexto: "Data de emissão no formato AAAA-MM-DD" },
                { nomeCampo: "cnpjEmissor", tipo: "texto", contexto: "CNPJ do prestador de serviço (emitente)" },
                { nomeCampo: "cnpjReceptor", tipo: "texto", contexto: "CNPJ do tomador de serviço (quem recebe a nota, geralmente a C3C)" },
                { nomeCampo: "nomeEmitente", tipo: "texto", contexto: "Razão social ou Nome Fantasia do prestador" }
            ]
        };

        try {
            const res = await axios.post(this.apiUrl, payload, {
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // IA pode demorar um pouco
            });
            return res.data;
        } catch (e) {
            console.error("❌ Erro na extração Gemini:", e.response?.data || e.message);
            throw new Error("Não foi possível extrair dados automaticamente do arquivo.");
        }
    }
}

module.exports = new ExtractionService();
