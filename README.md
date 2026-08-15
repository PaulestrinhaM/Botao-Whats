Rastreamento de Origem de Leads via WhatsApp
Sistema para recuperar a origem de marketing de um lead que converte pelo WhatsApp, sem formulário intermediário obrigatório e sem depender de ferramenta paga de atribuição. Implantado em produção para clientes de agência, com cerca de 6.500 leads rastreados somando as duas versões.

O repositório contém duas iterações do mesmo sistema. Elas resolvem o mesmo problema sob restrições de acesso diferentes, e a diferença entre elas é uma decisão de arquitetura, não de esforço. A comparação entre as duas é o ponto central deste README.
O problema
WhatsApp é um ponto cego de rastreamento. O visitante chega ao site por um anúncio, uma busca orgânica ou um link, clica no botão de WhatsApp e a conversa migra para um aplicativo que não carrega nenhum dado da sessão de origem. Do lado do comercial, o lead aparece do nada: não se sabe se veio de Google Ads, de Meta, de busca orgânica ou de tráfego direto. Sem isso, não há como medir custo de aquisição por canal nem atribuir receita à campanha certa.

A solução comum é obrigar o preenchimento de um formulário antes de liberar o WhatsApp, o que aumenta o atrito e derruba a conversão. O objetivo aqui foi capturar a origem preservando o caminho curto até a conversa.
A ideia
No momento em que o visitante aciona o WhatsApp, o sistema já guardou os parâmetros de origem da sessão (UTMs, gclid, fbclid, referer externo) em camadas de armazenamento no navegador. Esses dados são enviados a um backend em n8n, que os classifica por canal e grava numa planilha que o cliente acompanha. Na versão sem formulário, um código único de atendimento é gerado no clique e injetado na mensagem pré-preenchida, permitindo casar a conversa no WhatsApp com o registro de origem.

O backend classifica a origem por um modelo de last-click em cascata: se há gclid, é Google Ads; senão, se há fbclid, é Meta Ads; senão, se há UTM, usa a UTM; senão, se há referer externo, é tráfego direto de outro site; senão, orgânico. É o mesmo tipo de lógica de atribuição que plataformas pagas embutem, implementada em regras explícitas.
As duas versões
Versão 1 — via Google Tag Manager, sem acesso ao servidor
Restrição: sem acesso ao código-fonte do site do cliente. O único ponto de injeção de código é o GTM, que executa no navegador.

Consequência de arquitetura: não existe lugar para guardar um segredo. Qualquer chave colocada no script fica visível para quem abrir o DevTools. O script envia ao n8n com um header de autenticação, mas esse header não é uma proteção real, porque está exposto no cliente.

A proteção efetiva vive no n8n, que valida o header Origin da requisição. O Origin é setado pelo navegador e não pode ser sobrescrito por JavaScript de página, então essa checagem bloqueia abuso vindo de outros sites e de usuários pelo navegador, que é o vetor realista para um endpoint de captação. Ela não resiste a um atacante com ferramenta de linha de comando, que pode montar a requisição com qualquer header. Nenhuma validação client-side resistiria a isso; a proteção forte exigiria mover o segredo para fora do navegador, o que a versão 1 não permite.

Esta versão captura origem e gera código de atendimento. Não coleta dados estruturados do lead.

Arquivo: v1-gtm/rastreador-clique.js.
Versão 2 — via WordPress, com proxy server-side
Quando havia acesso ao WordPress do cliente, a limitação da versão 1 pôde ser resolvida. O segredo saiu do navegador e foi para um proxy no servidor.

O front chama uma rota REST do próprio WordPress (/wp-json/leadproxy/v1/lead) sem carregar nenhum segredo. Essa rota, um proxy em PHP, valida a requisição, injeta o segredo do n8n no servidor e repassa o lead. O navegador nunca vê a chave do n8n. Essa é a diferença central: na versão 1 o segredo estava exposto e a única defesa era o Origin; na versão 2 o segredo está protegido no servidor.

Um proxy assim tem uma armadilha própria. Proteger o segredo não basta se o endpoint do proxy aceitar qualquer requisição: quem descobrir a URL faz POST à vontade e o proxy repassa. A validação, portanto, precisa acontecer no proxy, antes de processar. Nesta implementação o permission_callback do WordPress confere a origem contra o domínio do cliente e aplica rate limit por IP usando transient. Isso eleva o custo de abuso de trivial para deliberado, que é o realista para um endpoint público de captura.

Esta versão também é mais completa do lado do lead: além da origem, coleta nome, e-mail, empresa, telefone (com máscara e validação de DDD) e interesse, num formulário em formato de chat. As UTMs têm expiração de 30 minutos, para não atribuir a uma campanha antiga uma conversão que aconteceu muito depois.

Arquivos: v2-wordpress/formulario-whatsapp.html (front) e v2-wordpress/proxy-lead.php (proxy).
Comparação


Versão 1 (GTM)
Versão 2 (WordPress)
Acesso disponível
só GTM (navegador)
WordPress (servidor)
Onde mora o segredo
exposto no navegador
protegido no servidor
Proteção do endpoint
Origin validado no n8n
origem + rate limit no proxy
Dados do lead
só origem + código
dados completos do formulário
Atrito para o usuário
nenhum (clique direto)
preenchimento do formulário


A leitura das duas em conjunto é o valor do projeto. A versão 1 não é uma tentativa fracassada corrigida pela versão 2. Ela é a melhor arquitetura possível dado o acesso que havia, e a versão 2 mostra o que muda quando a restrição sai. Escolher onde colocar o segredo é a decisão que separa as duas, e ela foi ditada pelo contexto, não por descuido.
Detalhes de implementação
Captura de origem em três camadas com fallback: sessionStorage, depois localStorage, depois cookie. Cobre casos em que o navegador bloqueia uma das camadas (modo privado, restrições de terceiros).

Envio com keepalive: true (versão 1): garante que o beacon de clique complete mesmo com o redirect imediato para o WhatsApp, que normalmente cancelaria a requisição em andamento.

Integração com Microsoft Clarity (versão 1): captura os IDs de sessão do Clarity junto do lead, permitindo cruzar a gravação de tela da visita com o registro de origem.

Retry no envio (versão 1): até duas novas tentativas em caso de falha de rede, com intervalo curto.
Segurança e sanitização
Os arquivos deste repositório estão sanitizados. Domínios, números de WhatsApp, paths de webhook e segredos foram substituídos por placeholders. Em produção, o segredo do n8n na versão 2 deve vir de constante em wp-config.php ou de variável de ambiente, nunca commitado.

As limitações de segurança de cada versão estão descritas em vez de omitidas. Um sistema de captura client-side tem um teto de proteção conhecido, e o projeto documenta onde esse teto está e como a arquitetura da versão 2 o eleva.
Stack
JavaScript puro no front (sem framework). n8n para orquestração e classificação de origem. Google Sheets como destino acessível ao cliente. PHP (WordPress REST API) no proxy da versão 2. Microsoft Clarity para cruzamento de sessão.

