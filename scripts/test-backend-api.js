require('dotenv').config();
const serviceController = require('../src/controllers/serviceController');

async function testBackend() {
    console.log("🔍 Testando integridade do Backend (serviceController)...");
    
    // Mock de Resposta
    const res = {
        json: (data) => { console.log("   ✅ JSON retornado com sucesso."); return data; },
        status: (code) => { 
            console.log(`   ${code === 200 ? '✅' : '❌'} Status: ${code}`); 
            return { json: (d) => { if(code >= 400) console.error("      Erro:", d.error || d.message); return d; } }; 
        },
        render: (view, data) => { console.log(`   ✅ View '${view}' renderizada com ${data.services?.length || 0} serviços.`); }
    };

    try {
        console.log("\n1. Testando listagem de serviços (renderServicesPage):");
        await serviceController.renderServicesPage({ session: { user: {} } }, res);

        console.log("\n2. Testando API de serviços (getServices):");
        await serviceController.getServices({ query: { status: 'active' } }, res);

        console.log("\n3. Verificando existência de funções críticas:");
        const criticalFunctions = [
            'getServiceDetails', 'saveService', 'saveSales', 
            'deleteSale', 'getServiceRealizedData', 'uploadDocument'
        ];
        
        criticalFunctions.forEach(fn => {
            if (typeof serviceController[fn] === 'function') {
                console.log(`   ✅ Função '${fn}' está definida.`);
            } else {
                console.error(`   ❌ ERRO: Função '${fn}' está faltando no controlador!`);
                process.exit(1);
            }
        });

        console.log("\n✅ Teste de Backend concluído com sucesso!");

    } catch (e) {
        console.error("\n🚨 FALHA CRÍTICA NO BACKEND:", e.message);
        process.exit(1);
    }
}

testBackend();
