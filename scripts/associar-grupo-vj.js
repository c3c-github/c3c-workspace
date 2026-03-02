require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGHeIAO'; // VJ
    
    console.log(`🔑 Verificando grupo OPERACAO para VJ...`);
    
    // 1. Busca ID do Grupo
    const qGrupo = `SELECT Id FROM GrupoPermissao__c WHERE Codigo__c = 'OPERACAO' LIMIT 1`;
    const resGrupo = await conn.query(qGrupo);
    
    if (resGrupo.totalSize === 0) {
        console.error("❌ Grupo OPERACAO não encontrado.");
        return;
    }
    const grupoId = resGrupo.records[0].Id;

    // 2. Verifica se já existe
    const qMembro = `SELECT Id FROM MembroGrupo__c WHERE Pessoa__c = '${targetId}' AND Grupo__c = '${grupoId}'`;
    const resMembro = await conn.query(qMembro);

    if (resMembro.totalSize > 0) {
        console.log("ℹ️  VJ já é membro do grupo OPERACAO.");
    } else {
        try {
            await conn.sobject('MembroGrupo__c').create({
                Pessoa__c: targetId,
                Grupo__c: grupoId
            });
            console.log("✅ VJ adicionado ao grupo OPERACAO.");
        } catch (e) {
            console.error("❌ Erro ao adicionar:", e.message);
        }
    }
}

run();
