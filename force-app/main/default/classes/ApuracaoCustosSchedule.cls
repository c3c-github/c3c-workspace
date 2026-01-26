public with sharing class ApuracaoCustosSchedule implements Schedulable {
    public void execute(SchedulableContext SC) {
        Database.executeBatch(new ApuracaoCustosBatch(), 200);
    }
}