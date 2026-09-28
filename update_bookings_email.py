import re

with open('/Users/macbookair/Documents/digital diaries/client work/Plumeria_Retreat_BackEnd_2.0/routes/bookings.js', 'r') as f:
    content = f.read()

# 1. Update sendPdfEmail function entirely (from 'async function sendPdfEmail(params) {' to the end of the function)
# The function ends around line 3725 where 'router.post("/success/verify/:txnid"' starts.
match = re.search(r'async function sendPdfEmail\(params\) \{.*?router\.post\("/success/verify/:txnid"', content, re.DOTALL)
if match:
    new_func = r'''async function sendPdfEmail(params) {
  const {
    email,
    name,
    BookingId,
    BookingDate,
    CheckinDate,
    CheckoutDate,
    totalPrice,
    advancePayable,
    remainingAmount,
    mobile,
    totalPerson,
    adult,
    child,
    vegCount,
    nonvegCount,
    joinCount,
    accommodationName,
    accommodationAddress,
    latitude,
    longitude,
    ownerEmail,
    ownerName,
    ownerPhone,
    coupon,
    discount,
    full_amount,
    rooms,
    acc_type,
    mealPlan,
    notes,
    activitiesTotal
  } = params;

  console.log("Sending PDF email to:", email);

  if (
    !email ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    console.error("❌ Invalid or missing email, aborting mail send:", email);
    return;
  }

  const type = acc_type === 'villa' ? 'Villa' : 'Cottage';
  const roomsCount = rooms || 1;
  const bookedDate = BookingDate; 
  
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">

<head>
  <meta http-equiv="Content-type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="format-detection" content="date=no" />
  <meta name="format-detection" content="address=no" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="x-apple-disable-message-reformatting" />
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Lato:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
  <title>Booking Confirmation</title>

  <style type="text/css" media="screen">
    body { padding: 0 !important; margin: 0 !important; display: block !important; min-width: 100% !important; width: 100% !important; background: #F9F7F5; -webkit-text-size-adjust: none; font-family: 'Lato', Arial, sans-serif; }
    a { color: #7D236F; text-decoration: none; }
    p { margin: 0 !important; }
    img { -ms-interpolation-mode: bicubic; display: block; }
    .mcnPreviewText { display: none !important; }
    @media only screen and (max-width: 600px) {
      .mobile-shell { width: 100% !important; min-width: 100% !important; padding: 0 10px !important; }
      .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; direction: ltr !important; }
      .mobile-center { text-align: center !important; }
      .table-responsive { font-size: 12px !important; }
      .table-responsive th, .table-responsive td { padding: 8px 6px !important; }
      .header-title { font-size: 18px !important; }
    }
  </style>
</head>

<body style="padding:0; margin:0; background:#F9F7F5; -webkit-text-size-adjust:none;">
  <span class="mcnPreviewText" style="display:none; font-size:0px; line-height:0px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; visibility:hidden; mso-hide:all;"></span>

  <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#F9F7F5">
    <tr>
      <td align="center" valign="top" style="padding: 24px 0;">

        <table width="650" border="0" cellspacing="0" cellpadding="0" class="mobile-shell" style="width:650px; max-width:650px; background:#ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(125, 35, 111, 0.08); border: 1px solid #ECE4DC;">
          
          <tr>
            <td height="6" bgcolor="#7D236F" style="background: linear-gradient(90deg, #7D236F 0%, #C48D2A 100%);"></td>
          </tr>

          <tr>
            <td style="padding: 24px 28px 20px; border-bottom: 2px solid #F3ECE5;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="middle" align="left">
                    <h1 class="header-title" style="margin: 0; color: #36414C; font-family: 'Cinzel', Georgia, serif; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; line-height: 26px;">
                      ${accommodationName}
                    </h1>
                    <div style="font-size: 13px; color: #7D236F; font-weight: bold; margin-top: 6px;">
                      Booking ID: <span style="background: #F8EDF5; padding: 2px 7px; border-radius: 4px; border: 1px solid #E8D0E3;">${BookingId}</span>
                    </div>
                    <div style="font-size: 13px; color: #736B65; margin-top: 4px;">
                      Booking Date: <span style="color: #2D2520;">${bookedDate}</span>
                    </div>
                  </td>
                  <td valign="middle" align="right" class="fluid-img" style="width: 170px;">
                    <img src="https://plumeriaretreat.com/assets/plumeria-removebg-preview-CWtMayYt.png" alt="Plumeria Retreat Logo" style="max-height: 60px; max-width: 160px; height: auto; width: auto;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 28px;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 16px; color: #2D2520; line-height: 24px; padding-bottom: 12px;">
                    Dear <b>${name}</b>,
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 14px; color: #4B4642; line-height: 22px; padding-bottom: 16px;">
                    <b>${accommodationName}</b> has received and registered your booking. The primary guest must present a copy of this confirmation e-voucher upon check-in.
                  </td>
                </tr>
                <tr>
                  <td style="background: #FCF8F2; border-left: 4px solid #C48D2A; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px;">
                    <div style="font-size: 14px; color: #2D2520; line-height: 22px;">
                      <b>Advance Payable:</b> <span style="color: #7D236F; font-size: 16px; font-weight: bold;">INR ${advancePayable}</span>
                      <br />
                      <span style="font-size: 12.5px; color: #6D645D;">
                        If there are any discrepancies, please write to us at 
                        <a href="mailto:${ownerEmail}" style="color: #7D236F; font-weight: bold; text-decoration: underline;">${ownerEmail}</a>.
                      </span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 12px; color: #8F8780; text-align: right; padding-top: 14px; padding-bottom: 6px;">
                    All prices are in INR (₹)
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" class="table-responsive" style="border-collapse: collapse; border: 1px solid #ECE4DC; border-radius: 8px; overflow: hidden; margin-top: 6px; margin-bottom: 24px;">
                <thead>
                  <tr bgcolor="#7D236F">
                    <th width="45%" align="left" style="color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px;">
                      Booking Details
                    </th>
                    <th width="55%" align="left" style="color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px; border-left: 1px solid #943A86;">
                      Tariff & Payment Breakup
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <!-- Guest & Stay Parameters -->
                    <td valign="top" style="padding: 14px; background: #FAF7F5; border-right: 1px solid #ECE4DC; font-size: 13px; line-height: 20px; color: #3E3834;">
                      <p style="padding-bottom: 6px;">Mobile: <b>${mobile}</b></p>
                      <p style="padding-bottom: 6px;">Check-In: <b>${CheckinDate}</b></p>
                      <p style="padding-bottom: 6px;">Check-Out: <b>${CheckoutDate}</b></p>
                      <p style="padding-bottom: 6px;">Rooms: <b>${roomsCount}</b></p>
                      <p style="padding-bottom: 6px;">${type === 'Villa' ? 'Total Guests' : 'Adults'}: <b>${adult}</b></p>
                      
                      ${mealPlan ? `<p style="padding-bottom: 6px;">Meal Plan: <b>${mealPlan}</b></p>` : ''}
                      
                      ${(type !== 'Villa' && child > 0) ? `
                        <p style="padding-bottom: 6px;">Children: <b>${child}</b></p>
                      ` : ''}
                    </td>

                    <!-- Financial Summary -->
                    <td valign="top" style="padding: 14px; background: #ffffff; font-size: 13px; line-height: 22px; color: #2D2520;">
                      <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="color: #6E6761; padding-bottom: 4px;">Base Amount:</td>
                          <td align="right" style="padding-bottom: 4px;"><b>₹${full_amount}</b></td>
                        </tr>

                        <!-- NEW ACTIVITIES ROW -->
                        ${(activitiesTotal && activitiesTotal > 0) ? `
                        <tr>
                          <td style="color: #6E6761; padding-bottom: 2px;">Activities & Add-ons:</td>
                          <td align="right" style="color: #2D2520; padding-bottom: 2px;"><b>+ ₹${activitiesTotal}</b></td>
                        </tr>
                        <tr>
                          <td colspan="2" style="font-size: 11px; color: #8F8780; padding-bottom: 6px; line-height: 14px;">
                            ${notes}
                          </td>
                        </tr>
                        ` : ''}
                        
                        ${(discount && discount > 0) ? `
                        <tr>
                          <td style="color: #6E6761; padding-bottom: 4px;">Discount:</td>
                          <td align="right" style="color: #2E7D32; padding-bottom: 4px;"><b>- ₹${discount}</b></td>
                        </tr>
                        ` : ''}

                        ${coupon ? `
                        <tr>
                          <td style="color: #6E6761; padding-bottom: 4px;">Coupon Applied:</td>
                          <td align="right" style="color: #C48D2A; font-weight: bold; padding-bottom: 4px;">${coupon}</td>
                        </tr>
                        ` : ''}

                        <tr style="border-top: 1px dashed #E0D7CF;">
                          <td style="padding-top: 6px; padding-bottom: 4px; font-weight: bold;">Total (incl. Taxes):</td>
                          <td align="right" style="padding-top: 6px; padding-bottom: 4px; font-weight: bold;">₹${totalPrice}</td>
                        </tr>
                        <tr>
                          <td style="color: #7D236F; font-weight: bold; padding-bottom: 4px;">Advance Paid:</td>
                          <td align="right" style="color: #7D236F; font-weight: bold; padding-bottom: 4px;">₹${advancePayable}</td>
                        </tr>
                        <tr style="border-top: 1px solid #ECE4DC;">
                          <td style="padding-top: 6px; color: #C48D2A; font-weight: bold;">Balance at Check-in:</td>
                          <td align="right" style="padding-top: 6px; color: #C48D2A; font-weight: bold; font-size: 14px;">₹${remainingAmount}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                <tr>
                  <td style="border-bottom: 2px solid #C48D2A; padding-bottom: 6px;">
                    <span style="color: #7D236F; font-family: 'Cinzel', Georgia, serif; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
                      Cancellation Policy
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 13px; color: #524B46; line-height: 20px; padding-top: 10px;">
                    From <b>${bookedDate}</b>, a 100% penalty applies upon cancellation. In case of a no-show, no refund will be provided. The reservation cannot be cancelled or modified on or after the scheduled date.
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #FAF7F5; border-radius: 8px; border: 1px solid #ECE4DC; margin-bottom: 22px;">
                <tr>
                  <td style="padding: 14px 16px;">
                    <div style="color: #7D236F; font-weight: bold; font-size: 13.5px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                      🎒 Things to Carry
                    </div>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 13px; color: #4B4642; line-height: 20px;">
                      <tr><td style="padding: 2px 0;">• Extra pair of clothing & comfortable footwear</td></tr>
                      <tr><td style="padding: 2px 0;">• Warm jackets/layers (temperatures drop pleasantly at Pawna Lake during night)</td></tr>
                      <tr><td style="padding: 2px 0;">• Toothbrush, paste, and essential personal toiletries</td></tr>
                      <tr><td style="padding: 2px 0;">• Personal medicines & insect repellent if needed</td></tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top: 2px solid #7D236F; padding-top: 14px; margin-bottom: 16px;">
                <tr>
                  <td>
                    <span style="color: #7D236F; font-family: 'Cinzel', Georgia, serif; font-size: 14px; font-weight: bold; text-transform: uppercase;">
                      Location & Contact Details
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 10px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50%" valign="top" class="stack-column" style="font-size: 13px; color: #443E3A; line-height: 20px; padding-right: 12px; padding-bottom: 12px;">
                          <b>${accommodationName}</b><br />
                          At: ${accommodationAddress}<br />
                          Pawna Lake, Maharashtra<br />
                          <div style="margin-top: 6px;">
                            <a href="http://maps.google.com/maps?q=${latitude},${longitude}" target="_blank" style="color: #C48D2A; font-weight: bold; text-decoration: underline;">
                              📍 View on Google Maps
                            </a>
                          </div>
                        </td>

                        <td width="50%" valign="top" class="stack-column" style="font-size: 13px; color: #443E3A; line-height: 20px; padding-bottom: 12px;">
                          <b>Email:</b> <a href="mailto:booking@plumeriaretreat.com" style="color: #7D236F;">booking@plumeriaretreat.com</a><br />
                          <b>Contact Person:</b> ${ownerName}<br />
                          <b>Phone:</b> <a href="tel:${ownerPhone}" style="color: #7D236F; font-weight: bold;">${ownerPhone}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td bgcolor="#FAF7F5" style="padding: 16px 28px; border-top: 1px solid #ECE4DC; text-align: center; font-size: 12px; color: #8F8780; line-height: 18px;">
              Please do not reply directly to this automated email. For any modifications, reach out to 
              <a href="mailto:${ownerEmail}" style="color: #7D236F; font-weight: bold;">${ownerEmail}</a>.<br />
              © ${accommodationName} • Pawna Lake Cottages & Camping
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    secure: false,
    port: 587,
    auth: {
      user: process.env.EMAIL_USER || "booking@plumeriaretreat.com",
      pass: process.env.EMAIL_PASS || "Plumeria@2020?",
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER || "booking@plumeriaretreat.com",
    to: email.trim(),
    cc: ownerEmail,
    bcc: "admin@plumeriaretreat.com",
    subject: "Resort Camping Booking",
    html: html,
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent:", info.response);
    return info;
  } catch (err) {
    console.error("❌ Mail send error:", err);
    throw err;
  }
}

router.post("/success/verify/:txnid"'''
    content = content[:match.start()] + new_func + content[match.end()-36:]

# 2. Add mealPlan: booking.meal_plan to the sendPdfEmail calls
content = content.replace(
    'acc_type: isvilla ? "villa" : "resort"',
    'acc_type: isvilla ? "villa" : "resort", mealPlan: booking.meal_plan'
)
content = content.replace(
    'rooms: bk.rooms || 1,',
    'rooms: bk.rooms || 1, mealPlan: bk.meal_plan,'
)
content = content.replace(
    "acc_type: acc.type.toLowerCase() || 'camping',",
    "acc_type: acc.type.toLowerCase() || 'camping', mealPlan: bk.meal_plan,"
)

with open('/Users/macbookair/Documents/digital diaries/client work/Plumeria_Retreat_BackEnd_2.0/routes/bookings.js', 'w') as f:
    f.write(content)
