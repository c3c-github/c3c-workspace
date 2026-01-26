public with sharing class ContaAzulSyncSchedule implements Schedulable {
    public void execute(SchedulableContext SC) {
        // Executa o batch com tamanho de lote reduzido para respeitar limite de callouts (100)
        Database.executeBatch(new ContaAzulSyncBatch(), 50);
    }
}