require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    
    console.log("♻️  Iniciando restauração via Apex Anônimo...");

    const apexCode = `
        Set<Id> allowedIds = new Set<Id>{
            'a14N5000009ZBczIAG', 'a14N5000009ZEKgIAO', 'a14N5000009ZF2EIAW', 
            'a14N5000009ZGHeIAO', 'a14N5000009ZGKrIAO', 'a14N5000009ZGPiIAO', 
            'a14N5000009ZGRJIA4', 'a14N5000009ZGcbIAG', 'a14N5000009Zj1uIAC', 
            'a14N500000AAJ21IAH', 'a14N500000Bd9t7IAB', 'a14N500000CBp1tIAD', 
            'a14N500000CjuGrIAJ', 'a14N500000Cjvb7IAB'
        };

        List<BeneficioPeriodo__c> toRestore = [
            SELECT Id FROM BeneficioPeriodo__c 
            WHERE IsDeleted = true 
            AND BeneficioPessoa__r.Name LIKE 'Caju %'
            AND BeneficioPessoa__r.Pessoa__c NOT IN :allowedIds
            ALL ROWS
        ];

        if (!toRestore.isEmpty()) {
            Database.UndeleteResult[] results = Database.undelete(toRestore, false);
            Integer count = 0;
            for(Database.UndeleteResult dr : results) if(dr.isSuccess()) count++;
            System.debug('RESTORED:' + count);
        } else {
            System.debug('NONE_TO_RESTORE');
        }
    `.trim();

    try {
        const res = await conn.tooling.executeAnonymous(apexCode);
        if (res.compiled && res.success) {
            console.log("✅ Processo de restauração finalizado no Salesforce.");
            // Verificando se restaurou algo
            if (res.debugLog && res.debugLog.includes('RESTORED:')) {
                const count = res.debugLog.split('RESTORED:')[1].split('\n')[0];
                console.log(`🎉 Sucesso! ${count} registros foram restaurados.`);
            } else {
                console.log("ℹ️  Nenhum registro precisava de restauração.");
            }
        } else {
            console.error("❌ Erro no Apex:", res.exceptionMessage);
        }
    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

run();
