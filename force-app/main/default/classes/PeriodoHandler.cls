public class PeriodoHandler {

    // CONTROLE DE RECURSÃO: 
    // Armazena os IDs que já tiveram seus dias calculados nesta transação.
    // Isso impede que a atualização automática dos campos de Roll-up (Horas__c, etc.) dispare novamente o gerenciamento.
    public static Set<Id> periodosProcessados = new Set<Id>();

    public static void gerenciarDiasPeriodo(List<Periodo__c> listaNovos) {
        
        List<Periodo__c> periodosParaProcessar = new List<Periodo__c>();
        
        for (Periodo__c p : listaNovos) {
            if (!periodosProcessados.contains(p.Id)) {
                periodosParaProcessar.add(p);
                periodosProcessados.add(p.Id);
            }
        }

        if (periodosParaProcessar.isEmpty()) return;

        Set<Id> periodoIds = new Set<Id>();
        Set<Id> estadoIds = new Set<Id>();
        Set<Id> municipioIds = new Set<Id>();
        Set<Id> pessoaIds = new Set<Id>();
        Date dataInicio;
        Date dataFim;

        // Iteramos sobre a lista FILTRADA
        for (Periodo__c p : periodosParaProcessar) {
            periodoIds.add(p.Id);
            
            if(dataInicio == null || p.DataInicio__c < dataInicio) 
                dataInicio = p.DataInicio__c;
            if(dataFim == null || p.DataFim__c > dataFim)
                dataFim = p.DataFim__c;
        }

        // Busca informações detalhadas dos períodos e pessoas relacionadas
        Map<Id, Periodo__c> periodoMap = new Map<Id, Periodo__c>([
            SELECT Id, DataInicio__c, DataFim__c, Estado__c, Municipio__c, Pessoa__c,
                   ContratoPessoa__r.Pessoa__c, ContratoPessoa__r.Pessoa__r.Municipio__c, ContratoPessoa__r.Pessoa__r.Municipio__r.Estado__c
            FROM Periodo__c 
            WHERE Id IN :periodoIds
        ]);

        for(Periodo__c p : periodoMap.values()) {
            Id est = p.Estado__c != null ? p.Estado__c : p.ContratoPessoa__r.Pessoa__r.Municipio__r.Estado__c;
            Id mun = p.Municipio__c != null ? p.Municipio__c : p.ContratoPessoa__r.Pessoa__r.Municipio__c;
            Id pes = p.Pessoa__c != null ? (Id)p.Pessoa__c : p.ContratoPessoa__r.Pessoa__c;
            if(est != null) estadoIds.add(est);
            if(mun != null) municipioIds.add(mun);
            if(pes != null) pessoaIds.add(pes);
        }

        Map<String, Boolean> feriadosRegionais = Util.verificarFeriadosRegionais(estadoIds, municipioIds, dataInicio, dataFim);
        Map<String, Boolean> mapearDiasDeFeriasPorPessoa = Util.mapearDiasDeFeriasPorPessoa(pessoaIds, dataInicio, dataFim);

        List<DiaPeriodo__c> novosDias = new List<DiaPeriodo__c>();

        // Busca Business Hours Padrão
        Id defaultBusinessHoursId;
        List<BusinessHours> bhList = [SELECT Id FROM BusinessHours WHERE IsDefault = true LIMIT 1];
        if (!bhList.isEmpty()) {
            defaultBusinessHoursId = bhList[0].Id;
        }

        for (Periodo__c periodo : periodoMap.values()) {
            Date dataAtual = periodo.DataInicio__c;
            Id est = periodo.Estado__c != null ? periodo.Estado__c : periodo.ContratoPessoa__r.Pessoa__r.Municipio__r.Estado__c;
            Id mun = periodo.Municipio__c != null ? periodo.Municipio__c : periodo.ContratoPessoa__r.Pessoa__r.Municipio__c;
            Id pes = periodo.Pessoa__c != null ? (Id)periodo.Pessoa__c : periodo.ContratoPessoa__r.Pessoa__c;

            while (dataAtual <= periodo.DataFim__c) {
                String diaFormatado = (dataAtual.day() < 10 ? '0' : '') + String.valueOf(dataAtual.day());
                String mesFormatado = (dataAtual.month() < 10 ? '0' : '') + String.valueOf(dataAtual.month());

                String nomeDiaSemana = Util.getNomeDiaSemanaPtBr(dataAtual);
                String tipo;
                
                // Meio dia do dia atual para testar no BusinessHours
                DateTime dataHora = DateTime.newInstance(dataAtual, Time.newInstance(12, 0, 0, 0));
                Boolean isDentroBH = (defaultBusinessHoursId != null) ? BusinessHours.isWithin(defaultBusinessHoursId, dataHora) : true;
                Boolean isFimDeSemana = (nomeDiaSemana == 'Sábado' || nomeDiaSemana == 'Domingo');

                // LÓGICA DE PRIORIDADE:
                // 1. Feriado Regional (Customizado)
                // 2. Feriado Sistêmico (Se não for fim de semana e o BH disser que não é útil)
                // 3. Férias
                // 4. Útil / Não Útil (Baseado no BH)

                if(est != null && feriadosRegionais.containsKey(est + '-' + dataAtual.format())) {
                    tipo = 'Feriado';
                } else if (mun != null && feriadosRegionais.containsKey(mun + '-' + dataAtual.format())) {
                    tipo = 'Feriado';
                } else if (!isDentroBH && !isFimDeSemana) {
                    // É feriado cadastrado no Salesforce e associado ao BusinessHours
                    tipo = 'Feriado';
                } else if(pes != null && mapearDiasDeFeriasPorPessoa.containsKey(pes + '-' + dataAtual.format())) {
                    tipo = 'Férias';
                } else if (isDentroBH) {
                    tipo = 'Útil';
                } else {
                    tipo = 'Não Útil';
                }

                DiaPeriodo__c dia = new DiaPeriodo__c(
                    Periodo__c = periodo.Id,
                    Name = diaFormatado + '/' + mesFormatado + ' - ' + nomeDiaSemana + (tipo == 'Férias' ? ' (Férias)' : (tipo == 'Feriado' ? ' (Feriado)' : '')),
                    Data__c = dataAtual,
                    Tipo__c = tipo != 'Férias' ? tipo : isFimDeSemana ? 'Não Útil' : tipo,
                    IdExterno__c = periodo.Id + '-' + dataAtual.format()
                );
                novosDias.add(dia);
                dataAtual = dataAtual.addDays(1);
            }
        }

        if (!novosDias.isEmpty()) {
            upsert novosDias IdExterno__c;
        }
    }
}