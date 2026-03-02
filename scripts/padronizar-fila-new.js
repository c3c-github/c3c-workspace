require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    
    console.log("🚀 Padronizando chamados em fila para status 'New'...");

    const apexCode = `
        Set<Id> accountIds = new Set<Id>();
        for (Servico__c s : [SELECT Conta__c FROM Servico__c WHERE Tipo__c = 'Suporte' AND Status__c = 'Ativo']) {
            if (s.Conta__c != null) accountIds.add(s.Conta__c);
        }

        List<Case> toUpdate = [
            SELECT Id FROM Case 
            WHERE AccountId IN :accountIds 
            AND Pessoa__c = null 
            AND IsClosed = false 
            AND Status != 'New'
            LIMIT 2000
        ];

        if (!toUpdate.isEmpty()) {
            for (Case c : toUpdate) c.Status = 'New';
            Database.update(toUpdate, false);
            System.debug('DONE');
        } else {
            System.debug('EMPTY');
        }
    `.trim();

    try {
        const res = await conn.tooling.executeAnonymous(apexCode);
        if (res.compiled && res.success) {
            console.log("✅ Lote de padronização da fila concluído!");
        } else {
            console.error("❌ Erro no Salesforce:", res.compileProblem || res.exceptionMessage);
        }
    } catch (e) {
        console.error("Erro fatal:", e.message);
    }
}

run();
