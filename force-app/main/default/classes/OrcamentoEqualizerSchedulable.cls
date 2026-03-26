/**
 * @description Agendador para rodar a equalização de orçamentos e disparar a cadeia de sincronização.
 */
global class OrcamentoEqualizerSchedulable implements Schedulable {
    global void execute(SchedulableContext sc) {
        // 1. Equalização (Síncrono)
        OrcamentoEqualizer.equalizeAllActive();
        
        // 2. Inicia o próximo passo da cadeia (Assincronamente)
        Database.executeBatch(new ApuracaoCustosBatch(), 200);
    }
}
