/**
 * Loads the plugin type augmentations for the whole compilation.
 *
 * @fastify/cookie declares `request.cookies` / `reply.setCookie` via module
 * augmentation, which only takes effect once the module is imported somewhere
 * in the program. The auth plugin and routes use those before app.ts registers
 * the plugin, so the import lives here rather than depending on file ordering.
 */
import '@fastify/cookie';
import '@fastify/rate-limit';
