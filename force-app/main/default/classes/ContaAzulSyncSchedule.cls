public with sharing class ContaAzulSyncSchedule implements Schedulable {
    public void execute(SchedulableContext SC) {
        // Dispara o sincronismo no Heroku
        ContaAzulSyncCallout.triggerSync();
    }
}