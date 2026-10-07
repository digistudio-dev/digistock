use serde::{Serialize, Serializer};

/// Erreur applicative sérialisée vers le frontend sous la forme `{ code, message }`.
/// Les messages destinés à l'utilisateur sont en français.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("Vous n'avez pas l'autorisation d'effectuer cette action.")]
    Forbidden,
    #[error("Cette fonctionnalité est disponible avec DigiStock Premium.")]
    Premium,
    #[error("Votre session a expiré. Veuillez vous reconnecter.")]
    Unauthenticated,
    #[error("{0}")]
    NotFound(String),
    #[error("Erreur de base de données : {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Erreur de fichier : {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Internal(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn validation(msg: impl Into<String>) -> Self {
        AppError::Validation(msg.into())
    }

    pub fn code(&self) -> &'static str {
        match self {
            AppError::Validation(_) => "validation",
            AppError::Forbidden => "forbidden",
            AppError::Premium => "premium_required",
            AppError::Unauthenticated => "unauthenticated",
            AppError::NotFound(_) => "not_found",
            AppError::Db(_) => "database",
            AppError::Io(_) => "io",
            AppError::Internal(_) => "internal",
        }
    }

    /// Message affiché à l'utilisateur. Les erreurs SQLite connues sont traduites.
    pub fn user_message(&self) -> String {
        if let AppError::Db(e) = self {
            let raw = e.to_string();
            if raw.contains("ux_products_barcode") || raw.contains("products.barcode") {
                return "Ce code-barres est déjà utilisé par un autre produit.".into();
            }
            if raw.contains("ux_products_sku") || raw.contains("products.sku") {
                return "Cette référence (SKU) est déjà utilisée par un autre produit.".into();
            }
            if raw.contains("ux_categories_name") {
                return "Une catégorie porte déjà ce nom.".into();
            }
            if raw.contains("users.username") {
                return "Cet identifiant est déjà utilisé.".into();
            }
            if raw.contains("roles.name") {
                return "Un rôle porte déjà ce nom.".into();
            }
            if raw.contains("database is locked") {
                return "La base de données est occupée. Réessayez dans un instant.".into();
            }
            return "Une erreur inattendue de base de données s'est produite. Aucune modification n'a été enregistrée.".into();
        }
        self.to_string()
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        match self {
            AppError::Db(_) | AppError::Io(_) | AppError::Internal(_) => {
                log::error!("[{}] {}", self.code(), self);
            }
            _ => log::debug!("[{}] {}", self.code(), self),
        }
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.user_message())?;
        s.end()
    }
}
