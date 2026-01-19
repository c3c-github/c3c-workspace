const { getSfConnection } = require('../src/config/salesforce');

async function testUpload() {
    try {
        const conn = await getSfConnection();
        const userId = (await conn.identity()).user_id;
        console.log("Conectado como User ID:", userId);

        const content = Buffer.from("Teste de upload via script Node.js").toString('base64');

        const cv = {
            Title: 'Teste Script Node.txt',
            PathOnClient: 'TesteScriptNode.txt',
            VersionData: content,
            FirstPublishLocationId: userId 
        };

        console.log("Tentando criar ContentVersion...");
        const ret = await conn.sobject('ContentVersion').create(cv);
        
        if (ret.success) {
            console.log("SUCESSO! ContentVersion criado. ID:", ret.id);
            
            // Buscar Document ID
            const q = await conn.query(`SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${ret.id}'`);
            console.log("ContentDocumentId:", q.records[0].ContentDocumentId);
        } else {
            console.error("ERRO ao criar:", ret.errors);
        }

    } catch (e) {
        console.error("EXCEÇÃO:", e);
    }
}

testUpload();