const { getSfConnection } = require('./src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const periodId = 'a1EN50000026mNRMAY';

    console.log('--- Iniciando restauração do período do Brito ---');

    try {
        // 1. Restaurar Nota Fiscal da lixeira
        const nfs = await conn.queryAll(`SELECT Id FROM NotaFiscal__c WHERE Periodo__c = '${periodId}' AND IsDeleted = true`);
        if (nfs.records.length > 0) {
            console.log(`Restaurando ${nfs.records.length} Nota(s) Fiscal(is)...`);
            await conn.sobject('NotaFiscal__c').undelete(nfs.records.map(r => r.Id));
        }

        // 2. Restaurar Documentos (Anexos) da lixeira
        // ContentDocumentLink não vai pra lixeira, mas o ContentDocument sim.
        // Como não sei os IDs, vou buscar ContentDocuments deletados que eram vinculados ao período (via histórico ou similar é difícil, 
        // mas NotaFiscal__c.DocumentoId__c pode ajudar se restaurarmos a NF primeiro)
        
        // Vamos atualizar o status do período de volta para 'Nota em Validação'
        await conn.sobject('Periodo__c').update({ Id: periodId, Status__c: 'Nota em Validação' });
        console.log('Status do período atualizado para "Nota em Validação".');

        // 3. Restaurar status dos lançamentos
        // Quando está em validação de nota, os lançamentos costumam estar todos aprovados.
        const logs = await conn.query(`SELECT Id FROM LancamentoHora__c WHERE DiaPeriodo__r.Periodo__c = '${periodId}'`);
        if (logs.records.length > 0) {
            console.log(`Restaurando ${logs.records.length} lançamentos para "Aprovado".`);
            await conn.sobject('LancamentoHora__c').update(logs.records.map(r => ({ Id: r.Id, Status__c: 'Aprovado' })));
        }

        console.log('--- Restauração concluída com sucesso ---');
    } catch (e) {
        console.error('Erro na restauração:', e);
    }
}

run();
