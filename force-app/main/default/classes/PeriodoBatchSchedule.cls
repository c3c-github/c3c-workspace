global class PeriodoBatchSchedule implements Schedulable {
    global void execute(SchedulableContext sc) {
        // Define o tamanho do lote (ex: 50) para evitar limites de governador, se necessário
        PeriodoBatch batch = new PeriodoBatch();
        Database.executeBatch(batch, 50);
    }
}