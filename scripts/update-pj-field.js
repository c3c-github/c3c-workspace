const { getSfConnection } = require('../src/config/salesforce');

async function updatePJ() {
    try {
        const conn = await getSfConnection();
        console.log('🚀 Buscando contratos com 8h...');
        
        const res = await conn.query("SELECT Id FROM ContratoPessoa__c WHERE Hora__c = 8");
        console.log(`📊 Encontrados ${res.totalSize} contratos.`);

        if (res.totalSize === 0) return;

        const updates = res.records.map(r => ({
            Id: r.Id,
            PJ__c: true
        }));

        console.log('⏳ Atualizando registros...');
        // O jsforce divide automaticamente em lotes de 200 para a API REST/SOAP
        const results = await conn.sobject('ContratoPessoa__c').update(updates);
        
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.length - successCount;

        console.log(`✅ Sucesso: ${successCount}`);
        if (errorCount > 0) {
            console.log(`❌ Erros: ${errorCount}`);
            results.filter(r => !r.success).forEach(r => console.log(`- ID ${r.id}: ${JSON.stringify(r.errors)}`));
        }

    } catch (e) {
        console.error('❌ Erro crítico:', e.message);
    }
}

updatePJ();