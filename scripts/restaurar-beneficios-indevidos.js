require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const allowedIds = [
        'a14N5000009ZBczIAG', 'a14N5000009ZEKgIAO', 'a14N5000009ZF2EIAW', 
        'a14N5000009ZGHeIAO', 'a14N5000009ZGKrIAO', 'a14N5000009ZGPiIAO', 
        'a14N5000009ZGRJIA4', 'a14N5000009ZGcbIAG', 'a14N5000009Zj1uIAC', 
        'a14N500000AAJ21IAH', 'a14N500000Bd9t7IAB', 'a14N500000CBp1tIAD', 
        'a14N500000CjuGrIAJ', 'a14N500000Cjvb7IAB'
    ];

    console.log("♻️  Iniciando restauração de benefícios indevidamente excluídos...");

    try {
        // Busca na lixeira
        const q = "SELECT Id, BeneficioPessoa__r.Pessoa__c, BeneficioPessoa__r.Name, Periodo__r.Name FROM BeneficioPeriodo__c WHERE IsDeleted = true AND BeneficioPessoa__r.Name LIKE 'Caju %' ALL ROWS";
        
        const res = await conn.query(q);
        
        if (res.totalSize === 0) {
            console.log("✅ Nada encontrado na lixeira para restaurar.");
            return;
        }

        const idsToRestore = res.records
            .filter(r => !allowedIds.includes(r.BeneficioPessoa__r.Pessoa__c))
            .map(r => r.Id);

        if (idsToRestore.length === 0) {
            console.log("✅ Todos os registros excluídos pertenciam aos 14 colaboradores permitidos. Nada a restaurar.");
            return;
        }

        console.log(`⚠️  Restaurando ${idsToRestore.length} registros para as outras pessoas...`);

        // Undelete via Apex Anônimo (pois jsforce destroy/create é REST, mas undelete é mais fácil via Apex)
        const apexCode = `Database.undelete(new List<Id>{${idsToRestore.map(id => `'${id}'`).join(',')}}, false);`;
        
        // Se a lista for muito grande, vamos fazer em pedaços via REST ou Tooling
        // Mas 500 IDs cabem no limite de 32k caracteres do Apex Anônimo
        
        const result = await conn.tooling.executeAnonymous(apexCode);
        
        if (res.compiled && result.success) {
            console.log("✅ Restauração concluída com sucesso!");
        } else {
            console.error("❌ Erro na restauração:", result.exceptionMessage);
        }

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

run();
