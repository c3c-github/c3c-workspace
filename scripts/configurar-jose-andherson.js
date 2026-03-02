require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGPiIAO'; // José Andherson
    
    console.log(`🚀 Configurando José Andherson (${targetId})...`);

    // --- 1. ALOCAÇÕES ---
    const qServ = `
        SELECT Id, Name 
        FROM Servico__c 
        WHERE Tipo__c = 'Suporte' 
        AND (Name LIKE '%ADAMA%' OR Name LIKE '%C3C Software%')
    `;
    
    const resServ = await conn.query(qServ);
    console.log(`\n📦 Encontrados ${resServ.totalSize} serviços para alocação:`);
    
    const allocations = [];
    resServ.records.forEach(s => {
        console.log(`   - ${s.Name}`);
        allocations.push({
            Pessoa__c: targetId,
            Servico__c: s.Id,
            DataInicio__c: '2026-02-01',
            DataFimOriginal__c: '2026-12-31',
            Percentual__c: 0
        });
    });

    if (allocations.length > 0) {
        try {
            const retAlloc = await conn.sobject('Alocacao__c').create(allocations);
            const success = retAlloc.filter(r => r.success).length;
            console.log(`✅ ${success}/${allocations.length} alocações criadas.`);
        } catch (e) {
            console.error("Erro alocações:", e.message);
        }
    }

    // --- 2. GRUPO OPERAÇÃO ---
    console.log(`\n🔑 Verificando grupo OPERACAO...`);
    
    // Busca ID do Grupo OPERACAO
    const qGrupo = `SELECT Id FROM GrupoPermissao__c WHERE Codigo__c = 'OPERACAO' LIMIT 1`;
    const resGrupo = await conn.query(qGrupo);
    
    if (resGrupo.totalSize === 0) {
        console.error("❌ Grupo OPERACAO não encontrado.");
        return;
    }
    const grupoId = resGrupo.records[0].Id;

    // Verifica se já é membro
    const qMembro = `SELECT Id FROM MembroGrupo__c WHERE Pessoa__c = '${targetId}' AND Grupo__c = '${grupoId}'`;
    const resMembro = await conn.query(qMembro);

    if (resMembro.totalSize > 0) {
        console.log("ℹ️  Já é membro do grupo OPERACAO.");
    } else {
        try {
            await conn.sobject('MembroGrupo__c').create({
                Pessoa__c: targetId,
                Grupo__c: grupoId
            });
            console.log("✅ Adicionado ao grupo OPERACAO.");
        } catch (e) {
            console.error("Erro grupo:", e.message);
        }
    }
}

run();
