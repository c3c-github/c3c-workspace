require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();

    const className = 'DeleteZeroHourEntriesBatch';
    const classBody = `
/**
 * @description Batch para excluir registros de LancamentoHora__c que possuem Horas__c e HorasExtras__c zeradas.
 */
public with sharing class DeleteZeroHourEntriesBatch implements Database.Batchable<sObject> {
    
    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([
            SELECT Id 
            FROM LancamentoHora__c 
            WHERE Horas__c = 0 
            AND HorasExtras__c = 0 
            AND (HorasBanco__c = 0 OR HorasBanco__c = null)
            AND (HorasAusenciaRemunerada__c = 0 OR HorasAusenciaRemunerada__c = null)
            AND (HorasAusenciaNaoRemunerada__c = 0 OR HorasAusenciaNaoRemunerada__c = null)
        ]);
    }

    public void execute(Database.BatchableContext bc, List<LancamentoHora__c> scope) {
        if (!scope.isEmpty()) {
            delete scope;
        }
    }

    public void finish(Database.BatchableContext bc) {
        System.debug('✅ Batch de exclusão de lançamentos zerados finalizado.');
    }
}
`.trim();

    console.log(`🚀 Tentando criar a classe Apex: ${className}...`);

    try {
        // Tenta criar via Registro ApexClass (Precisa de permissão de Autor de Apex)
        // Nota: Se a classe já existir, o Salesforce pode retornar erro de duplicidade.
        const ret = await conn.sobject('ApexClass').create({
            Name: className,
            Body: classBody
        });

        if (ret.success) {
            console.log(`✅ Classe ${className} criada com sucesso! ID: ${ret.id}`);
        } else {
            console.error("❌ Erro ao criar classe:", ret.errors);
            if(ret.errors[0].statusCode === 'DUPLICATE_VALUE') {
                console.log("ℹ️  A classe já existe. Prosseguindo para execução...");
            } else {
                throw new Error("Falha na criação.");
            }
        }

        console.log(`\n⚙️  Executando o Batch...`);
        const apexCode = `Database.executeBatch(new ${className}());`;
        const apexRes = await conn.tooling.executeAnonymous(apexCode);

        if (apexRes.compiled && apexRes.success) {
            console.log("✅ Batch enviado para fila de execução com sucesso!");
        } else {
            console.error("❌ Erro na execução Apex:", apexRes.compileProblem || apexRes.exceptionMessage);
        }

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
        console.log("\n💡 Dica: Se falhar a criação por falta de privilégios, você pode rodar o código do Batch diretamente como 'Apex Anônimo' se o volume de dados não for gigantesco.");
    }
}

run();
