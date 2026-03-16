const { getSfConnection } = require('../src/config/salesforce');

async function runTest() {
    console.log('🧪 Teste de Sincronização (Pasta Única para o Ciclo)...');
    try {
        const conn = await getSfConnection();
        const periods = ['a1EN50000026mNoMAI', 'a1EN50000026mNfMAI'];
        for (const id of periods) { await testInternalSync(conn, id); }
    } catch (e) { console.error('❌ Erro:', e.message); }
}

async function testInternalSync(conn, periodId) {
    const microsoftGraphService = require('../src/services/microsoftGraphService');
    const periodQuery = `SELECT Name, DataInicio__c, DataFim__c, ContratoPessoa__r.Pessoa__r.Name, (SELECT Id, DocumentoId__c FROM NotasFiscais__r WHERE Tipo__c = 'Entrada' LIMIT 1) FROM Periodo__c WHERE Id = '${periodId}' LIMIT 1`;
    const resPeriod = await conn.query(periodQuery);
    const p = resPeriod.records[0];
    const nf = p.NotasFiscais__r.records[0];

    const cv = await conn.sobject('ContentVersion').find({ ContentDocumentId: nf.DocumentoId__c, IsLatest: true }).limit(1).execute();
    const fileData = await conn.sobject('ContentVersion').record(cv[0].Id).blob('VersionData');
    const chunks = []; for await (let chunk of fileData) { chunks.push(chunk); }
    const buffer = Buffer.concat(chunks);

    const periodBaseName = p.Name.split(' - ')[0];
    const fmt = (d) => d ? d.split('-').reverse().map((v, i) => i === 2 ? v.substring(2) : v).join('-') : '';
    const folderName = `${periodBaseName} - ${fmt(p.DataInicio__c)} - ${fmt(p.DataFim__c)}`;
    const fileName = `${p.ContratoPessoa__r.Pessoa__r.Name} - ${nf.Id}.${cv[0].FileExtension}`;

    console.log(`[Test] 📂 Destino: ${folderName}/${fileName}`);
    const targetPath = await microsoftGraphService.ensureFolderExists(folderName);
    await microsoftGraphService.uploadFile(targetPath, fileName, buffer);
}

runTest();