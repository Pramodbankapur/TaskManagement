/**
 * Google Apps Script webhook bridge.
 * Attach this to a Form submit trigger and update constants.
 */
const API_URL = "http://YOUR_SERVER_HOST/api/public/google-form";
const SHARED_SECRET = "replace_with_same_secret_as_server_env";

function onFormSubmit(e) {
  const values = e.namedValues;
  const payload = {
    secret: SHARED_SECRET,
    organizationName: values["Company / Organization Name"][0],
    contactName: values["Your Name"][0],
    email: values["Email"][0],
    phone: values["Phone"][0],
    description: values["Complaint / Task description"][0]
  };

  UrlFetchApp.fetch(API_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}
