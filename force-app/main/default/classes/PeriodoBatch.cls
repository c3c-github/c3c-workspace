global class PeriodoBatch implements Database.Batchable<SObject>, Database.Stateful {

    Map<Id, ContratoPessoa__c> contratoMaisRecentePorPessoa = new Map<Id, ContratoPessoa__c>();

    global Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([
            SELECT Id, Pessoa__c, DataInicio__c, Pessoa__r.Name
            FROM ContratoPessoa__c
            WHERE Status__c = 'Ativo' AND Pessoa__c != null
        ]);
    }

    global void execute(Database.BatchableContext bc, List<ContratoPessoa__c> scope) {
        for (ContratoPessoa__c contrato : scope) {
            Id pessoaId = contrato.Pessoa__c;
            if (!contratoMaisRecentePorPessoa.containsKey(pessoaId) ||
                contrato.DataInicio__c > contratoMaisRecentePorPessoa.get(pessoaId).DataInicio__c) {
                contratoMaisRecentePorPessoa.put(pessoaId, contrato);
            }
        }
    }

    global void finish(Database.BatchableContext bc) {
        // Buscar configuração padrão da organização
        ConfiguracaoPeriodo__c config = ConfiguracaoPeriodo__c.getOrgDefaults();

        Date hoje = Date.today();
        Integer ano = hoje.year();
        Integer mes = hoje.month();

        Integer diaInicio = (config != null && config.DiaInicioPeriodo__c != null) ? Integer.valueOf(config.DiaInicioPeriodo__c) : 1;
        Integer ultimoDiaDoMes = Date.daysInMonth(ano, mes);
        if (diaInicio > ultimoDiaDoMes) {
            diaInicio = ultimoDiaDoMes;
        }

        Date dataInicioPeriodo = Date.newInstance(ano, mes, diaInicio);
        Date dataFimPeriodo = dataInicioPeriodo.addMonths(1).addDays(-1);

        List<Periodo__c> periodos = new List<Periodo__c>();
        for (ContratoPessoa__c contrato : contratoMaisRecentePorPessoa.values()) {
            Pessoa__c pessoa = contrato.Pessoa__r;
            if (pessoa == null) continue;

            DateTime dtInicio = DateTime.newInstance(dataInicioPeriodo, Time.newInstance(0, 0, 0, 0));
            String nomeMes = Util.getNomeMesPtBr(dataInicioPeriodo);
            String nomePeriodo = nomeMes + ' ' + String.valueOf(dataInicioPeriodo.year()) + ' - ' + pessoa.Name;

            Periodo__c p = new Periodo__c();
            p.ContratoPessoa__c = contrato.Id;
            p.DataInicio__c = dataInicioPeriodo;
            p.DataFim__c = dataFimPeriodo;
            p.Name = nomePeriodo;
            p.IdExterno__c = contrato.Pessoa__c + '-' + dtInicio.format('yyyy-MM-dd');
            periodos.add(p);
        }

        if (!periodos.isEmpty()) {
            upsert periodos idExterno__c;
        }
    }
}