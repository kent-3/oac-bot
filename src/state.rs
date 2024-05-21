use color_eyre::eyre::{eyre, Error};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::Path,
    time::{Duration, Instant},
};
use teloxide::types::UserId;
use tracing::{debug, error, info, warn};

const SHADE_API: &'static str = "https://prodv1.securesecrets.org/graphql";

pub fn save_oac_members_to_file(oac_members: &HashSet<UserId>, file_path: &Path) -> io::Result<()> {
    let serialized =
        serde_json::ser::to_string(oac_members).expect("Failed to serialize oac_members");
    fs::write(file_path, serialized)
}

pub fn load_oac_members_from_file(file_path: &Path) -> io::Result<HashSet<UserId>> {
    let file_contents = fs::read(file_path)?;
    let deserialized: HashSet<UserId> =
        serde_json::de::from_slice(&file_contents).expect("Failed to deserialize oac_members");
    Ok(deserialized)
}

#[derive(Debug, Deserialize)]
pub struct GraphqlResponse<T> {
    pub data: T,
}

#[derive(Debug, Deserialize)]
pub struct Tokens {
    pub tokens: Vec<Token>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub description: String,
    pub logo_path: Option<String>,
    #[serde(rename = "PriceToken")]
    pub price_token: Vec<PriceToken>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceToken {
    pub price_id: String,
    pub value: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct Prices {
    pub prices: Vec<Price>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Price {
    pub id: String,
    pub value: Option<f64>,
}

// ---

#[derive(Debug)]
pub struct Cache {
    pub data: Vec<Token>,
    pub last_price_fetch_time: Instant,
    pub last_token_fetch_time: Instant,
}

impl Cache {
    pub fn new() -> Self {
        Cache {
            data: Vec::<Token>::new(),
            // set to a past time to trigger initial fetch
            last_token_fetch_time: Instant::now() - Duration::from_secs(60 * 60 * 24 + 1),
            last_price_fetch_time: Instant::now() - Duration::from_secs(5 * 60 + 1),
        }
    }

    pub fn tokens_need_update(&self) -> bool {
        self.last_token_fetch_time.elapsed() > Duration::from_secs(60 * 60 * 24)
    }

    pub fn prices_need_update(&self) -> bool {
        self.last_price_fetch_time.elapsed() > Duration::from_secs(5 * 60)
    }

    pub async fn fetch_and_cache_tokens(&mut self) -> Result<&mut Self, Error> {
        let now = Instant::now();
        let time_diff = now.duration_since(self.last_token_fetch_time).as_secs();

        if time_diff > 60 * 60 * 24 || self.data.is_empty() {
            info!("Fetching and caching tokens...");

            let client = Client::new();
            let mut tokens = get_tokens(&client, SHADE_API).await?;
            filter_and_sort_tokens(&mut tokens);

            self.data = tokens;
            self.last_token_fetch_time = now;
        }

        Ok(self)
    }

    pub async fn fetch_and_cache_prices(&mut self) -> Result<&mut Self, Error> {
        let now = Instant::now();
        let time_diff = now.duration_since(self.last_price_fetch_time).as_secs();

        if time_diff > 5 * 60 || self.data.is_empty() {
            info!("Fetching and caching prices...");

            let client = Client::new();
            let prices = get_prices(&client, SHADE_API).await?;
            update_prices(&mut self.data, prices);

            self.last_price_fetch_time = now;
        }

        Ok(self)
    }

    pub fn search(&self, symbol: &str) -> Vec<&Token> {
        let symbol = symbol.to_lowercase();

        self.data
            .iter()
            .filter(|&item| item.symbol.to_lowercase().contains(symbol.trim()))
            .collect()
    }
}

async fn get_tokens(client: &Client, url: &str) -> Result<Vec<Token>, Error> {
    let payload = json!({
        "operationName": "getTokens",
        "variables": {},
        "query": r#"
                query getTokens {
                    tokens {
                        id
                        name
                        symbol
                        description
                        logoPath
                        PriceToken {
                            priceId
                        }
                    }
                }
            "#
    });

    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await?;

    if response.status().is_success() {
        let body = response.text().await?;
        let data: GraphqlResponse<Tokens> = serde_json::from_str(&body)?;
        Ok(data.data.tokens)
    } else {
        Err(eyre!("Request failed with status: {}", response.status()))
    }
}

async fn get_prices(client: &Client, url: &str) -> Result<Vec<Price>, Error> {
    let payload = json!({
        "operationName": "getPrices",
        "variables": {
            "ids": []
        },
        "query": r#"
            query getPrices($ids: [String!]) {
                prices(query: {ids: $ids}) {
                    id
                    value
                    __typename
                }
            }
        "#
    });

    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await?;

    if response.status().is_success() {
        let body = response.text().await?;
        let data: GraphqlResponse<Prices> = serde_json::from_str(&body)?;
        Ok(data.data.prices)
    } else {
        Err(eyre!("Request failed with status: {}", response.status()))
    }
}

fn filter_and_sort_tokens(tokens: &mut Vec<Token>) {
    // Filter out LP tokens and tokens with no price
    tokens.retain(|token| {
        !token.name.contains("SHADESWAP Liquidity Provider (LP)") && !token.price_token.is_empty()
    });

    // Sort the tokens alphabetically by name
    tokens.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
}

fn update_prices(tokens: &mut Vec<Token>, prices: Vec<Price>) {
    let price_map: HashMap<String, Option<f64>> = prices
        .into_iter()
        .map(|price| (price.id, price.value))
        .collect();

    for token in tokens {
        for price_token in &mut token.price_token {
            if let Some(price_value) = price_map.get(&price_token.price_id) {
                price_token.value = *price_value;
            }
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[tokio::test]
    async fn test_main() -> Result<(), Error> {
        let client = Client::new();
        let mut tokens = get_tokens(&client, SHADE_API).await?;
        filter_and_sort_tokens(&mut tokens);

        let prices = get_prices(&client, SHADE_API).await?;
        update_prices(&mut tokens, prices);

        println!("Tokens with associated prices: {:#?}", tokens);
        println!("# of Tokens: {}", tokens.len());
        Ok(())
    }
}
