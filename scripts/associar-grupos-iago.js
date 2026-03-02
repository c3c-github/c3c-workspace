require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZEFsIAO'; // Iago
    const targetGroups = ['GESTAO_SUPORTE', 'OPERACAO'];

    console.log(`🔍 Buscando grupos: ${targetGroups.join(', ')}...`);

    // 1. Busca IDs dos Grupos
    const qGrupos = `SELECT Id, Codigo__c FROM GrupoPermissao__c WHERE Codigo__c IN ('${targetGroups.join("', '")}')`;
    const resGrupos = await conn.query(qGrupos);
    
    if (resGrupos.totalSize === 0) {
        console.error("❌ Nenhum grupo encontrado. Verifique os códigos.");
        return;
    }

    const groupMap = {};
    resGrupos.records.forEach(g => groupMap[g.Codigo__c] = g.Id);

    // 2. Verifica associações existentes
    const qMembros = `SELECT Grupo__r.Codigo__c FROM MembroGrupo__c WHERE Pessoa__c = '${targetId}'`;
    const resMembros = await conn.query(qMembros);
    const existingGroups = new Set(resMembros.records.map(m => m.Grupo__r.Codigo__c));

    const toCreate = [];

    targetGroups.forEach(code => {
        if (existingGroups.has(code)) {
            console.log(`ℹ️  O Iago já possui acesso ao grupo: ${code}`);
        } else if (groupMap[code]) {
            console.log(`➕ Preparando associação para o grupo: ${code}`);
            toCreate.push({
                Pessoa__c: targetId,
                Grupo__c: groupMap[code]
            });
        } else {
            console.error(`❌ Grupo não encontrado no Salesforce: ${code}`);
        }
    });

    if (toCreate.length === 0) {
        console.log("✅ Nada a fazer.");
        return;
    }

    // 3. Cria as associações
    try {
        const ret = await conn.sobject('MembroGrupo__c').create(toCreate);
        const success = ret.filter(r => r.success).length;
        console.log(`
✅ ${success} associações criadas com sucesso para o Iago.`);
        if (success < ret.length) {
            console.error("❌ Erros:", ret.filter(r => !r.success));
        }
    } catch (e) {
        console.error("Erro fatal:", e.message);
    }
}

run();
