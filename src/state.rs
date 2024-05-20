use color_eyre::eyre::{eyre, Error, OptionExt};
use color_eyre::Report;
use reqwest::Client;
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Deserialize, Serialize)]
pub struct GraphqlResponse<T> {
    pub data: T,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Tokens {
    pub tokens: Vec<Token>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub id: String,
    pub name: String,
    pub code_hash: Option<String>,
    pub contract_address: Option<String>,
    pub denom: Option<String>,
    pub flags: Vec<String>,
    pub symbol: String,
    pub description: String,
    #[serde(rename = "Chain")]
    pub chain: Chain,
    #[serde(rename = "Asset")]
    pub asset: Asset,
    pub logo_path: Option<String>,
    #[serde(rename = "PriceToken")]
    pub price_token: Vec<PriceToken>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Chain {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Asset {
    pub id: String,
    pub decimals: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceToken {
    pub price_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
}

// ---

#[derive(Debug, Deserialize, Serialize)]
pub struct Prices {
    pub prices: Vec<Price>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Price {
    pub id: String,
    pub value: Option<f64>,
}

// ---

#[derive(Debug, Clone)]
pub struct MyToken {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub description: String,
    pub logo_path: Option<String>,
    pub price: f64,
}

#[derive(Debug)]
pub struct Cache {
    pub last_fetch_time: Instant,
    pub data: Vec<MyToken>,
}

impl Cache {
    pub fn new() -> Self {
        Cache {
            data: Vec::<MyToken>::new(),
            // set to a past time to trigger initial fetch
            last_fetch_time: Instant::now() - Duration::from_secs(5 * 60 + 1),
        }
    }

    pub fn needs_update(&self) -> bool {
        self.last_fetch_time.elapsed() > Duration::from_secs(5 * 60)
    }

    pub async fn fetch_and_cache_data(&mut self) -> Result<Vec<MyToken>, Report> {
        let now = Instant::now();
        let time_diff = now.duration_since(self.last_fetch_time).as_secs();

        if time_diff > 5 * 60 || self.data.is_empty() {
            debug!("Fetching and caching data...");

            let client = Client::new();
            let tokens = get_tokens(&client, SHADE_API).await?;
            let prices = get_prices(&client, SHADE_API).await?;
            let data = process_tokens(tokens, prices);

            self.data = data;
            self.last_fetch_time = now;
        }

        Ok(self.data.clone())
    }

    pub fn search(&self, name: &str) -> Vec<&MyToken> {
        let name = name.to_lowercase();

        self.data
            .iter()
            .filter(|&item| item.name.to_lowercase().contains(name.trim()))
            .collect()
    }
}

async fn get_tokens(client: &Client, url: &str) -> Result<Vec<Token>, Report> {
    let payload = json!({
        "operationName": "getTokens",
        "variables": {},
        "query": r#"
                query getTokens {
                    tokens {
                        id
                        name
                        codeHash
                        contractAddress
                        denom
                        flags
                        symbol
                        description
                        Chain {
                            id
                        }
                        Asset {
                            id
                            decimals
                        }
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
        .await
        .unwrap();

    if response.status().is_success() {
        let body = response.text().await?;
        let data: GraphqlResponse<Tokens> = serde_json::from_str(&body)?;
        Ok(data.data.tokens)
    } else {
        Err(eyre!("Request failed with status: {}", response.status()))
    }
}

async fn get_prices(client: &Client, url: &str) -> Result<Vec<Price>, Report> {
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
        .await
        .unwrap();

    if response.status().is_success() {
        let body = response.text().await?;
        let data: GraphqlResponse<Prices> = serde_json::from_str(&body)?;
        Ok(data.data.prices)
    } else {
        Err(eyre!("Request failed with status: {}", response.status()))
    }
}

fn process_tokens(tokens: Vec<Token>, prices: Vec<Price>) -> Vec<MyToken> {
    let price_map: HashMap<String, Option<f64>> = prices
        .into_iter()
        .map(|price| (price.id, price.value))
        .collect();

    let mut my_tokens: Vec<MyToken> = tokens
        .into_iter()
        .filter(|token| !token.name.contains("SHADESWAP Liquidity Provider (LP)"))
        .filter_map(|mut token| {
            let price = token.price_token.get_mut(0).and_then(|pt| {
                pt.value = price_map.get(&pt.price_id).copied().flatten();
                pt.value
            });

            price.map(|price| MyToken {
                id: token.id,
                name: token.name,
                symbol: token.symbol,
                description: token.description,
                logo_path: token.logo_path,
                price,
            })
        })
        .collect();

    // Sort the tokens alphabetically by name
    my_tokens.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    my_tokens
}

#[cfg(test)]
mod test {
    use super::*;

    #[tokio::test]
    async fn test_main() -> Result<(), Report> {
        let client = Client::new();
        let tokens = get_tokens(&client, SHADE_API).await?;
        let prices = get_prices(&client, SHADE_API).await?;
        let data = process_tokens(tokens, prices);

        println!("Tokens with associated prices: {:#?}", data);
        println!("# of Tokens: {}", data.len());
        Ok(())
    }
}
