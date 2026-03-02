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

    public void execute(Database.BatchableContext bc, List<sObject> scope) {
        if (!scope.isEmpty()) {
            delete scope;
        }
    }

    public void finish(Database.BatchableContext bc) {
        System.debug('✅ Batch de exclusão de lançamentos zerados finalizado.');
    }
}
