trigger ContactPhoneFormat on Contact (before insert, before update) {
    /* -----------------------------------------------------------
       LÓGICA DESATIVADA EM: 31/12/2025
       MOTIVO: Regra de validação de telefone bloqueando operação.
       -----------------------------------------------------------

    for(Contact c : Trigger.New)
    {
        if(c.MobilePhone == null)
            continue;
        
        String telefone = c.MobilePhone;

        telefone = telefone.replaceAll('[^0-9]', '');

        if (telefone.length() != 13 && telefone.length() != 12)
        {
            c.addError('Preencha o celular com os dígitos do DDI, do DDD e do número.');
        } else {
            String telefoneSemDDD;

            if(telefone.length() == 12)
                telefoneSemDDD = telefone.subString(telefone.length()-8, telefone.length());
            else
                telefoneSemDDD = telefone.subString(telefone.length()-9, telefone.length());

            String telefoneUltimosDigitos = telefoneSemDDD.subString(telefoneSemDDD.length()-4, telefoneSemDDD.length());
            String telefonePrimeirosDigitos = telefoneSemDDD.replace(telefoneUltimosDigitos, '');

            String ddWithoutNumber = telefone.replace(telefoneSemDDD, '');
            String ddd = ddWithoutNumber.length() <= 2 ? ddWithoutNumber : ddWithoutNumber.subString(ddWithoutNumber.length()-2, ddWithoutNumber.length());
            String ddi = ddWithoutNumber.replace(ddd, '');

            String telefoneFormatado =  (ddi.length() > 0 ? '+'+ddi+' ' : '')+
                                        (ddd.length() > 0 ? '('+ddd+') ' : '')+
                                        (telefonePrimeirosDigitos+'-'+telefoneUltimosDigitos);

            c.MobilePhone = telefoneFormatado;
        }
    }
    */
}