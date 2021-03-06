const addButton  = document.querySelector("#addLink")
const waitIcon   = document.querySelector("#waitIcon")
const sendIcon   = document.querySelector("#sendIcon")
const linkField  = document.querySelector("#linkField")
const table 	 = document.querySelector("table")
const alert 	 = document.querySelector("#alert")

waitIcon.style.display = "none"

let messages = []

addButton.addEventListener("click", (e) => {
	e.preventDefault()
	linkField.setAttribute("disabled", true)
	addButton.setAttribute("disabled", true)

	let url = linkField.value
	if(!url.trim()){
		_addAlertMessage("warning", "Please enter a link first.")
		linkField.removeAttribute("disabled")
		addButton.removeAttribute("disabled")
		
		return
	}

	if(schedule === null){
		window.alert("We saved your article but you must select your favorite days, hour and timezone (then save) to receive it. You can do this at the end of the page")
	}

	console.log(url)
	waitIcon.style.display = "inline"
	sendIcon.style.display = "none"

	fetch("/api/link/add", {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ link: url })
	}).then((response) => {
		return response.json()
	}).then((data) => {
		if (data.success) {
			table.querySelector("tbody").insertAdjacentHTML("beforeend", "<tr> <td><i class=\"fas fa-smile\" title=\"This link has just been added\"></i></td> <td><a href=" + url + " target=\"_blank\" style=\"text-decoration: none;\"><span style=\"color:#777;\">No title yet.</span></a></td> <td class=\"arLinks\"><i class=\"fas fa-trash-alt\" onclick=\"_delete(" + data.linkId + ")\" id=\"l" + data.linkId + "\"></i></td> </tr>")
			_addAlertMessage("info", "This link has been added to your list, read it soon in your inbox!")
		} else {
			_addAlertMessage("warning", "This link seems unavailable. Please retry 🙏")
		}
		linkField.removeAttribute("disabled")
		addButton.removeAttribute("disabled")
		waitIcon.style.display = "none"
		sendIcon.style.display = "inline"
		linkField.value = ""
	})
	.catch((err) => {
		console.log(err)
		_addAlertMessage("warning", "Can't reach server. Please retry 🙏")
		linkField.removeAttribute("disabled")
		addButton.removeAttribute("disabled")
		waitIcon.style.display = "none"
		sendIcon.style.display = "inline"
	})
})

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
		window.history.pushState("Account", document.title, window.location.href.split("?")[0])
	}
}

let _addAlertMessage = (type, text, duration = 5000) => {
	let symbol = ""
	alert.style.display = "block"
	if(type == "info"){ symbol = '<i class="fas fa-info-circle"></i>' }
	else if(type == "warning"){ symbol = '<i class="fas fa-exclamation-triangle"></i>' }
	else if(type == "thanks"){ symbol = '<i class="fas fa-heart"></i>' }
	else{ alert.style.display = "none"; return }
	messages.push("<div id='a" + messages.length + "' onclick=\"_hide(" + messages.length + ")\">" + symbol + " " + text + "</div>")
	alert.innerHTML += messages[messages.length - 1]

	setTimeout(() => {
		alert.querySelector("div>div").remove()
		messages.shift()
		if(messages.length === 0){
			alert.style.display = "none"
		} 
	}, duration)
}

let _hide = (id) => {
	document.querySelector("div#a" + id).addEventListener("click", function (e) {
		this.style.display = "none"
		if (document.querySelectorAll("#alert>div:not([style*=\"display: none\"])").length === 0) {
			alert.style.display = "none"
		}
	})
}

let _prioritize = (id) => {
	let r = confirm("Do you want to send this link next and override current priority (if one is set)?")
	if(r){
		fetch('/api/link/' + id, {
			method: "PATCH",
			credentials: 'same-origin',
			headers: {
				"Content-Type": "application/json"
			}
		}).then((res) => { return res.json() })
		.then((data) => {
			if (data.success) {
				_addAlertMessage("info", "This link has been prioritized!")
				document.querySelector(`#p${id}`).style.display = "none"
			} else {
				if(data.message == "premium"){
					_addAlertMessage("warning", "Doing this requires you to be premium for the price of a coffee")
				}else{
					_addAlertMessage("warning", "It seems like this link can't be prioritized..")
				}
			}
		})
	}
}

let _resend = (id) => {
	let r = confirm("Do you want to add this link to the queue?")
	if(r){
		fetch("/api/link/" + id, {
			method: "PUT",
			credentials: 'same-origin',
			headers: {
				"Content-Type": "application/json"
			}
		}).then((res) => { return res.json() })
		.then((data) => {
			if (data.success) {
				_addAlertMessage("info", "This link has been added to the queue!")
				document.querySelector(`#rsl${id}`).classList = "fas fa-trash-alt"
				document.querySelector(`#rsl${id}`).id = "l" + id
				document.querySelector(`#l${id}`).setAttribute("onclick", `_delete(${id})`)
			} else {
				if (data.message == "premium") {
					_addAlertMessage("warning", "Doing this requires you to be premium for the price of a coffee")
				} else {
					_addAlertMessage("warning", "It seems like this link can't be updated..")
				}
			}
		})
	}
}

let _delete = (id) => {
	let r = confirm("Are you sure you want to delete this link?")
	if(r){
		// Delete
		fetch("/api/link/" + id, {
			method: "DELETE",
			credentials: 'same-origin',
			headers: {
				"Content-Type": "application/json"
			}
		}).then((res) => {return res.json()})
		  .then((data) => {
		  	if(data.success){
				_addAlertMessage("info", "This link has been deleted!")
				document.querySelector(`#l${id}`).parentNode.parentNode.remove() // Remove link
		  	}else{
		  		_addAlertMessage("warning", "It seems like this link can't be deleted..")
		  	}
		  })
	}
}

document.querySelector("#delete_account").addEventListener("click", (e) => {
	e.preventDefault()
	let r1 = confirm("Are you sure you want to delete your account? This is irreversible")
	if(r1){
		let r2 = confirm("Last confirmation before operation: have you decided to delete all your data from ClearList?")
		if(r2){
			fetch("/api/account", {
				method: "DELETE",
				credentials: 'same-origin',
				headers: {
					"Content-Type": "application/json"
				}
			}).then((res) => { return res.json() })
			  .then((data) => {
				if (data.success) {
					window.location.replace("/?toast=info&message=Your-account-has-been-deleted!")
				}
			})
		}
	}
})