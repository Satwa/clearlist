const alert = document.querySelector("#alert")
let messages = []

window.onload = () => {
	var getUrlParameter = (sParam) => {
		var sPageURL = decodeURIComponent(window.location.search.substring(1)),
			sURLVariables = sPageURL.split('&'),
			sParameterName,
			i;

		for (i = 0; i < sURLVariables.length; i++) {
			sParameterName = sURLVariables[i].split('=');

			if (sParameterName[0] === sParam) {
				return sParameterName[1] === undefined ? true : sParameterName[1];
			}
		}
	}

	if(getUrlParameter("toast") && getUrlParameter("message")){ // auto-load alert
		_addAlertMessage(getUrlParameter("toast"), getUrlParameter("message").split("-").join(" "))
		window.history.pushState("Home", document.title, window.location.href.split("?")[0])
	}
}

let _addAlertMessage = (type, text, duration = 5000) => {
	let sign = ""
	alert.style.display = "block"
	if(type == "info"){ sign = '<i class="fas fa-info-circle"></i>' }
	else if(type == "warning"){ sign = '<i class="fas fa-exclamation-triangle"></i>' }
	else if(type == "thanks"){ sign = '<i class="fas fa-heart"></i>' }
	else{ alert.style.display = "none"; return }
	messages.push("<div id='a" + messages.length + "'>" + sign + " " + text + "</div>")
	alert.innerHTML += messages[messages.length - 1]
	setTimeout(() => { 
		alert.querySelector("div>div").remove()
		messages.shift()
		if(messages.length === 0){
			alert.style.display = "none"
		} 
	}, duration)
}