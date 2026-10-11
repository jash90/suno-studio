// Mówi backendowi Convex, by ufał tokenom JWT wydawanym przez Convex Auth
// (issuer = URL httpActions deploymentu, audience = "convex"). Bez tego pliku
// logowanie „przechodzi", ale sesja nigdy nie staje się uwierzytelniona.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
