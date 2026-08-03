<?php
/*
 * VERSÃO 2 — Proxy server-side no WordPress
 *
 * Registra uma rota REST no WordPress que recebe o lead do front, valida a
 * requisição e só então repassa para o n8n, injetando o segredo no servidor.
 * O front NUNCA vê o segredo do n8n. Essa é a diferença central em relação à
 * versão 1 (GTM), onde o segredo ficava exposto no navegador.
 *
 * O ponto crítico é o permission_callback. Um proxy que aceita qualquer
 * requisição (permission_callback => '__return_true') protege o segredo mas
 * deixa o próprio endpoint escancarado: qualquer um que descubra a URL faz
 * POST à vontade e o proxy repassa. Isso troca um furo por outro.
 *
 * A versão abaixo valida ANTES de processar: confere a origem contra o domínio
 * do cliente e aplica rate limit por IP. Não é blindagem absoluta (origem por
 * header não resiste a linha de comando), mas eleva o custo de abuso de
 * "trivial" para "precisa querer", que é o realista para um endpoint de captura.
 *
 * Coloque este arquivo em functions.php do tema-filho, ou melhor, num plugin
 * próprio (mu-plugin), para não perder em atualização de tema.
 */

// Domínio(s) autorizado(s) a consumir o proxy.
define('LEADPROXY_ORIGENS_PERMITIDAS', [
  'https://SEU-DOMINIO.exemplo.com.br',
  'https://www.SEU-DOMINIO.exemplo.com.br',
]);

// Segredo do n8n. Em produção, prefira uma constante em wp-config.php
// (define('LEADPROXY_N8N_SENHA', '...')) ou variável de ambiente, fora do
// controle de versão. Nunca commite o valor real.
define('LEADPROXY_N8N_URL',   'https://SEU-N8N.exemplo.com/webhook/SEU-PATH');
define('LEADPROXY_N8N_SENHA', getenv('LEADPROXY_N8N_SENHA') ?: 'DEFINA_EM_WP_CONFIG');

// Rate limit: máximo de requisições por IP por janela.
define('LEADPROXY_RATE_MAX', 10);      // requisições
define('LEADPROXY_RATE_JANELA', 60);   // segundos

add_action('rest_api_init', function () {
  register_rest_route('leadproxy/v1', '/lead', [
    'methods'             => 'POST',
    'callback'            => 'leadproxy_proxy_lead',
    'permission_callback' => 'leadproxy_validar_requisicao',
  ]);
});

/**
 * Roda ANTES do callback. Se retornar false (ou WP_Error), o WordPress
 * rejeita a requisição sem nunca chegar ao proxy.
 */
function leadproxy_validar_requisicao(WP_REST_Request $request) {
  // 1. Valida a origem. Origin é setado pelo navegador e não é forjável por
  //    JS de página. Cobre o vetor de abuso via browser.
  $origin = $request->get_header('origin');
  if (empty($origin)) {
    // Sem Origin: pode ser navegação same-origin legítima. Cai no Referer.
    $referer = $request->get_header('referer');
    $origin  = $referer ? parse_url($referer, PHP_URL_SCHEME) . '://' . parse_url($referer, PHP_URL_HOST) : '';
  }
  if (!in_array($origin, LEADPROXY_ORIGENS_PERMITIDAS, true)) {
    return new WP_Error('origem_negada', 'Origem não autorizada.', ['status' => 403]);
  }

  // 2. Rate limit por IP, usando transient do WordPress como contador.
  $ip    = leadproxy_ip_cliente();
  $chave = 'leadproxy_rl_' . md5($ip);
  $hits  = (int) get_transient($chave);
  if ($hits >= LEADPROXY_RATE_MAX) {
    return new WP_Error('rate_limit', 'Muitas requisições.', ['status' => 429]);
  }
  set_transient($chave, $hits + 1, LEADPROXY_RATE_JANELA);

  return true;
}

/**
 * Repassa o lead para o n8n com o segredo. Só executa se a validação passou.
 */
function leadproxy_proxy_lead(WP_REST_Request $request) {
  $payload = $request->get_json_params();
  if (empty($payload) || !is_array($payload)) {
    return new WP_REST_Response(['ok' => false, 'erro' => 'payload inválido'], 400);
  }

  $response = wp_remote_post(LEADPROXY_N8N_URL, [
    'headers' => [
      'Content-Type' => 'application/json',
      'senha'        => LEADPROXY_N8N_SENHA,
    ],
    'body'    => wp_json_encode($payload),
    'timeout' => 10,
  ]);

  if (is_wp_error($response)) {
    return new WP_REST_Response(['ok' => false], 502);
  }

  return new WP_REST_Response(['ok' => true], 200);
}

/**
 * IP real do cliente, considerando proxy reverso (Cloudflare, nginx).
 * Ordem de confiança conforme a infra; ajuste ao seu ambiente.
 */
function leadproxy_ip_cliente() {
  $candidatos = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'];
  foreach ($candidatos as $c) {
    if (!empty($_SERVER[$c])) {
      $ip = trim(explode(',', $_SERVER[$c])[0]);
      if (filter_var($ip, FILTER_VALIDATE_IP)) {
        return $ip;
      }
    }
  }
  return '0.0.0.0';
}
