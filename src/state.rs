use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    error::Error,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TokenPrice {
    pub id: String,
    pub name: String,
    pub value: String,
    pub price_24hr_change: String,
}

#[derive(Debug)]
pub struct Cache {
    pub last_fetch_time: Instant,
    pub data: Vec<TokenPrice>,
}

impl Cache {
    pub fn new() -> Self {
        Cache {
            data: Vec::<TokenPrice>::new(),
            // set to a past time to trigger initial fetch
            last_fetch_time: Instant::now() - Duration::from_secs(5 * 60 + 1),
        }
    }

    pub fn needs_update(&self) -> bool {
        self.last_fetch_time.elapsed() > Duration::from_secs(5 * 60)
    }

    pub async fn fetch_and_cache_data(&mut self) -> Result<Vec<TokenPrice>, reqwest::Error> {
        let now = Instant::now();
        let time_diff = now.duration_since(self.last_fetch_time).as_secs();

        if time_diff > 5 * 60 || self.data.is_empty() {
            debug!("Fetching and caching data...");

            let response = reqwest::get(SHADE_API).await?;

            if response.status().is_success() {
                let mut data = response.json::<Vec<TokenPrice>>().await?;
                process_data(&mut data);
                self.data = data;
                self.last_fetch_time = now;
            } else {
                error!("Request failed with status: {}", response.status());
            }
        }

        Ok(self.data.clone())
    }

    pub fn search(&self, name: &str) -> Vec<&TokenPrice> {
        let name = name.to_lowercase();

        self.data
            .iter()
            .filter(|&item| {
                item.name.to_lowercase().contains(name.trim()) && !item.name.ends_with("LP")
            })
            .collect()
    }
}

fn process_data(data: &mut [TokenPrice]) {
    data.sort_unstable_by(|a, b| a.name.cmp(&b.name))
}

async fn get_tokens(client: &Client, url: &str) -> Result<Vec<Token>, Box<dyn Error>> {
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
        Err(Box::from(format!(
            "Request failed with status: {}",
            response.status()
        )))
    }
}

async fn get_prices(client: &Client, url: &str) -> Result<Vec<Price>, Box<dyn Error>> {
    let url = "https://prodv1.securesecrets.org/graphql";
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

    let client = Client::new();
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
        Err(Box::from(format!(
            "Request failed with status: {}",
            response.status()
        )))
    }
}

// ---

// #[derive(Debug, Deserialize, Serialize)]
// struct TokenResponseData {
//     data: Tokens,
// }

#[derive(Debug, Deserialize, Serialize)]
struct GraphqlResponse<T> {
    data: T,
}

#[derive(Debug, Deserialize, Serialize)]
struct Tokens {
    tokens: Vec<Token>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Token {
    id: String,
    name: String,
    code_hash: Option<String>,
    contract_address: Option<String>,
    denom: Option<String>,
    flags: Vec<String>,
    symbol: String,
    description: String,
    #[serde(rename = "Chain")]
    chain: Chain,
    #[serde(rename = "Asset")]
    asset: Asset,
    logo_path: Option<String>,
    #[serde(rename = "PriceToken")]
    price_token: Vec<PriceToken>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Chain {
    id: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct Asset {
    id: String,
    decimals: u8,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PriceToken {
    price_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<f64>,
}

// ---

// #[derive(Debug, Deserialize, Serialize)]
// struct PriceResponseData {
//     data: Prices,
// }

#[derive(Debug, Deserialize, Serialize)]
struct Prices {
    prices: Vec<Price>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Price {
    id: String,
    value: Option<f64>,
}

fn associate_prices(tokens: &mut [Token], prices: &[Price]) {
    let price_map: HashMap<String, Option<f64>> = prices
        .iter()
        .map(|price| (price.id.clone(), price.value))
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
    async fn test_main() -> Result<(), Box<dyn Error>> {
        let client = Client::new();
        let mut tokens = get_tokens(&client, SHADE_API).await?;
        let prices = get_prices(&client, SHADE_API).await?;
        associate_prices(&mut tokens, &prices);
        println!("Tokens with associated prices: {:#?}", tokens);
        Ok(())
    }
}
