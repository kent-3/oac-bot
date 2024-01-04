#![allow(unused)]

async fn handle_empty_inline_query(bot: &Bot, q: &InlineQuery) -> HandlerResult {
    log::debug!("Empty query");

    let article = InlineQueryResult::Article(
        InlineQueryResultArticle::new(
            "000",
            "Type something to search",
            InputMessageContent::Text(InputMessageContentText::new("@two_amber_bot")),
        )
        .thumb_url(reqwest::Url::parse(
            "https://raw.githubusercontent.com/kent-3/amber-app/main/static/amber-logo.png",
        )?),
    );

    let response = bot
        .answer_inline_query(&q.id, vec![article])
        .switch_pm_text("Powered by Amber")
        .switch_pm_parameter("amber_rocks")
        .send()
        .await;
    if let Err(err) = response {
        log::error!("Error in inline query handler: {:?}", err);
    };

    Ok(())
}
