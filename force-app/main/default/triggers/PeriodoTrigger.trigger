trigger PeriodoTrigger on Periodo__c (after insert, after update) {
    if (Trigger.isAfter) {
        if (Trigger.isInsert || Trigger.isUpdate) {
            PeriodoHandler.gerenciarDiasPeriodo(Trigger.new);
        }
    }
}