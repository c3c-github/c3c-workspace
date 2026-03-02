require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();

    const classes = [
        {
            name: 'DeleteZeroHourEntriesBatch',
            body: `
public with sharing class DeleteZeroHourEntriesBatch implements Database.Batchable<sObject> {
    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator('SELECT Id FROM LancamentoHora__c WHERE Horas__c = 0 AND HorasExtras__c = 0 AND (HorasBanco__c = 0 OR HorasBanco__c = null) AND (HorasAusenciaRemunerada__c = 0 OR HorasAusenciaRemunerada__c = null) AND (HorasAusenciaNaoRemunerada__c = 0 OR HorasAusenciaNaoRemunerada__c = null)');
    }
    public void execute(Database.BatchableContext bc, List<sObject> scope) {
        if (!scope.isEmpty()) delete scope;
    }
    public void finish(Database.BatchableContext bc) {
        System.debug('✅ Batch Finalizado');
    }
}
`
        },
        {
            name: 'DeleteZeroHourEntriesBatchTest',
            body: `
@isTest
private class DeleteZeroHourEntriesBatchTest {
    @isTest
    static void testBatch() {
        Pessoa__c p = new Pessoa__c(Name = 'T', Email__c = 't@t.com'); insert p;
        Servico__c s = new Servico__c(Name = 'S', DataInicio__c = Date.today()); insert s;
        insert new LancamentoHora__c(Pessoa__c = p.Id, Servico__c = s.Id, Horas__c = 0, HorasExtras__c = 0);
        Test.startTest();
        Database.executeBatch(new DeleteZeroHourEntriesBatch());
        Test.stopTest();
        System.assertEquals(0, [SELECT COUNT() FROM LancamentoHora__c WHERE Horas__c = 0]);
    }
}
`
        }
    ];

    for (const c of classes) {
        console.log(`🚀 Criando/Atualizando ${c.name}...`);
        try {
            // Usa Metadata API via JSforce para ser mais flexível que o CLI
            await conn.metadata.upsert('ApexClass', {
                fullName: c.name,
                content: Buffer.from(c.body).toString('base64'),
                apiVersion: '60.0',
                status: 'Active'
            });
            console.log(`✅ ${c.name} OK.`);
        } catch (e) {
            console.error(`❌ Erro em ${c.name}:`, e.message);
        }
    }

    console.log(`\n⚙️  Executando o Batch...`);
    const apexRes = await conn.tooling.executeAnonymous('Database.executeBatch(new DeleteZeroHourEntriesBatch());');
    if (apexRes.compiled && apexRes.success) {
        console.log("✅ Batch em execução!");
    } else {
        console.error("❌ Erro:", apexRes.compileProblem || apexRes.exceptionMessage);
    }
}

run();
