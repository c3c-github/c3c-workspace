const { getSfConnection } = require('../src/config/salesforce');

async function fixArthur() {
    const conn = await getSfConnection();
    const periodId = 'a1EN50000026mNRMAY';
    
    console.log('Buscando lançamentos...');
    const res = await conn.query(`SELECT Id FROM LancamentoHora__c WHERE Periodo__c = '${periodId}'`);
    
    if (res.records.length > 0) {
        console.log(`Atualizando ${res.records.length} lançamentos para Rascunho...`);
        const updates = res.records.map(r => ({ Id: r.Id, Status__c: 'Rascunho' }));
        await conn.sobject('LancamentoHora__c').update(updates);
    }
    
    console.log('Atualizando período para Aberto...');
    await conn.sobject('Periodo__c').update({ Id: periodId, Status__c: 'Aberto' });
    
    console.log('✅ Finalizado com sucesso.');
}

fixArthur().catch(console.error);
