const microsoftGraphService = require('../src/services/microsoftGraphService');

async function testConnection() {
    console.log('🔌 Testando conexão com Microsoft Graph...');
    try {
        const token = await microsoftGraphService.getAccessToken();
        console.log('✅ Token obtido com sucesso!');

        const testPath = 'Teste Conexao';
        console.log(`📂 Verificando/Criando pasta: ${testPath}...`);
        const path = await microsoftGraphService.ensureFolderExists(testPath);
        console.log(`✅ Pasta confirmada em: ${path}`);

        console.log('📤 Enviando arquivo de teste...');
        const buffer = Buffer.from('Arquivo de teste gerado pelo sistema C3C - ' + new Date().toISOString());
        await microsoftGraphService.uploadFile(path, 'teste_conexao.txt', buffer);
        console.log('🚀 Teste finalizado com sucesso!');

    } catch (e) {
        console.error('❌ Falha no teste:', e.message);
        if (e.response) console.error('Dados do erro:', JSON.stringify(e.response.data));
    }
}

testConnection();