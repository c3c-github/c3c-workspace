require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    
    console.log("🚀 Executando ciclos de padronização (1000 por vez)...");

    for (let i = 1; i <= 5; i++) {
        console.log(`\n📦 Ciclo ${i}:`);
        
        const apexCode = `
            Set<Id> accountIds = new Set<Id>();
            for (Servico__c s : [SELECT Conta__c FROM Servico__c WHERE Tipo__c = 'Suporte' AND Status__c = 'Ativo']) {
                if (s.Conta__c != null) accountIds.add(s.Conta__c);
            }

            List<Case> toUpdate = [
                SELECT Id FROM Case 
                WHERE AccountId IN :accountIds 
                AND IsClosed = true 
                AND Status != 'Closed'
                LIMIT 1000
            ];

            if (!toUpdate.isEmpty()) {
                for (Case c : toUpdate) c.Status = 'Closed';
                Database.update(toUpdate, false);
                System.debug('DONE');
            } else {
                System.debug('EMPTY');
            }
        `.trim();

        try {
            const res = await conn.tooling.executeAnonymous(apexCode);
            if (res.compiled && res.success) {
                if (res.debugLog && res.debugLog.includes('EMPTY')) {
                    console.log("✅ Concluído! Não restam chamados para atualizar.");
                    break;
                }
                console.log("✅ Lote concluído.");
            } else {
                console.error("❌ Erro no ciclo:", res.exceptionMessage);
                break;
            }
        } catch (e) {
            console.error("Erro fatal no ciclo:", e.message);
            break;
        }
    }
}

run();
