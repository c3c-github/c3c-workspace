
Map<Id, DiaPeriodo__c> diasParaAtualizar = new Map<Id, DiaPeriodo__c>();

// 1. Busca todos os lançamentos de Fevereiro de 2026
List<LancamentoHora__c> lancamentos = [
    SELECT Id, DiaPeriodo__c, Horas__c, HorasExtras__c, HorasBanco__c, 
           HorasAusenciaRemunerada__c, HorasAusenciaNaoRemunerada__c
    FROM LancamentoHora__c
    WHERE DiaPeriodo__r.Data__c >= 2026-02-01 
    AND DiaPeriodo__r.Data__c <= 2026-02-28
    LIMIT 40000
];

for (LancamentoHora__c l : lancamentos) {
    if (!diasParaAtualizar.containsKey(l.DiaPeriodo__c)) {
        diasParaAtualizar.put(l.DiaPeriodo__c, new DiaPeriodo__c(
            Id = l.DiaPeriodo__c,
            Hora__c = 0,
            HoraExtra__c = 0,
            HoraBanco__c = 0,
            HoraLicencaRemunerada__c = 0,
            HoraLicencaNaoRemunerada__c = 0
        ));
    }
    
    DiaPeriodo__c dia = diasParaAtualizar.get(l.DiaPeriodo__c);
    dia.Hora__c += (l.Horas__c != null ? l.Horas__c : 0);
    dia.HoraExtra__c += (l.HorasExtras__c != null ? l.HorasExtras__c : 0);
    dia.HoraBanco__c += (l.HorasBanco__c != null ? l.HorasBanco__c : 0);
    dia.HoraLicencaRemunerada__c += (l.HorasAusenciaRemunerada__c != null ? l.HorasAusenciaRemunerada__c : 0);
    dia.HoraLicencaNaoRemunerada__c += (l.HorasAusenciaNaoRemunerada__c != null ? l.HorasAusenciaNaoRemunerada__c : 0);
}

if (!diasParaAtualizar.isEmpty()) {
    update diasParaAtualizar.values();
    System.debug('✅ Sincronizados ' + diasParaAtualizar.size() + ' registros de DiaPeriodo__c.');
} else {
    System.debug('ℹ️ Nenhum lançamento encontrado para o período informado.');
}
