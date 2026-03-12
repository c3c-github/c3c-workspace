public class Util {

    public static Set<Date> feriados;

    private static final Map<Integer, String> MESES_PT_BR = new Map<Integer, String>{
        1 => 'Janeiro',
        2 => 'Fevereiro',
        3 => 'Março',
        4 => 'Abril',
        5 => 'Maio',
        6 => 'Junho',
        7 => 'Julho',
        8 => 'Agosto',
        9 => 'Setembro',
        10 => 'Outubro',
        11 => 'Novembro',
        12 => 'Dezembro'
    };

    public static String getNomeMesPtBr(Date data) {
        if (data == null) return '';
        return MESES_PT_BR.get(data.month());
    }

    // Retorna o nome do dia da semana em português (ex: Segunda-feira)
    public static String getNomeDiaSemanaPtBr(Date data) {
        List<String> dias = new List<String>{
            'Domingo', 'Segunda-feira', 'Terça-feira',
            'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'
        };
        return dias[data.toStartOfWeek().daysBetween(data)];
    }

    // Verifica se uma data é feriado com base no cache
    public static Boolean verificarFeriado(Date data) {
        if (feriados == null) {
            carregarFeriados();
        }
        return feriados.contains(data);
    }

    // Carrega os feriados da organização no cache
    public static void carregarFeriados() {
        feriados = new Set<Date>();
        for (Holiday h : [SELECT ActivityDate FROM Holiday WHERE ActivityDate != null]) {
            feriados.add(h.ActivityDate);
        }
    }

    public static Map<String, Boolean> verificarFeriadosRegionais(Set<Id> estadoIds, Set<Id> municipioIds, Date inicio, Date fim) {
        Map<String, Boolean> resultado = new Map<String, Boolean>();

        // Busca todos os feriados regionais no período
        List<FeriadoRegional__c> feriados = [
            SELECT Municipio__c, Estado__c, Data__c, RecordType.Name 
            FROM FeriadoRegional__c 
            WHERE Data__c >= :inicio
            AND Data__c <= :fim
            AND (Municipio__c IN :municipioIds OR Estado__c IN :estadoIds)
        ];

        for (FeriadoRegional__c fr : feriados) {
            String chave;
            if (fr.RecordType.Name == 'Estadual') {
                chave = fr.Estado__c;
            }else if(fr.RecordType.Name == 'Municipal') {
                chave = fr.Municipio__c;
            } else {
                continue; // Ignora outros tipos de feriados
            }
            chave = chave + '-' + fr.Data__c.format();            
            resultado.put(chave, true);
        }

        return resultado;
    }

    public static Map<String, Boolean> mapearDiasDeFeriasPorPessoa(Set<Id> pessoaIds, Date dataInicio, Date dataFim) {
        Map<String, Boolean> mapa = new Map<String, Boolean>();

        if (pessoaIds == null || pessoaIds.isEmpty() || dataInicio == null || dataFim == null) {
            return mapa;
        }

        // Busca todas as férias ativas que interceptam o período
        List<Ferias__c> ferias = [
            SELECT Pessoa__c, DataInicio__c, DataFim__c
            FROM Ferias__c
            WHERE Pessoa__c IN :pessoaIds
              AND Status__c = 'Agendada'
              AND (
                  DataInicio__c <= :dataFim AND DataFim__c >= :dataInicio
              )
        ];

        // Preenche o mapa com os dias de férias
        for (Ferias__c f : ferias) {
            Date inicio = f.DataInicio__c < dataInicio ? dataInicio : f.DataInicio__c;
            Date fim = f.DataFim__c > dataFim ? dataFim : f.DataFim__c;

            for (Date d = inicio; d <= fim; d = d.addDays(1)){
                String chave = f.Pessoa__c + '-' + d.format(); // YYYY-MM-DD
                mapa.put(chave, true);
            }
        }

        return mapa;
    }

    public static String getSessionIdFromCookie() {
        Map<String, System.Cookie> cookies = ApexPages.currentPage().getCookies();
        if (cookies != null && cookies.containsKey('sessao')) {
            return cookies.get('sessao').getValue();
        }
        return null;
    }

}